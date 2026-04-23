import { Room, type Client } from "colyseus"
import { randomUUID } from "node:crypto"

import { verifyToken } from "../../auth"
import { createGameSimulation, type GameSimulation } from "../../game/simulation"
import { createSessionEconomy, attemptPurchase, buildShopStatePayload } from "../../gameserver/sessionShop"
import type { SessionEconomy } from "../../gameserver/sessionShop"
import { TICK_MS } from "../../../shared/balance-config/rendering"
import { ARENA_SPAWN_POINTS } from "../../../shared/balance-config/arena"
import { RoomEvent } from "../../../shared/roomEvents"
import type {
  AuthUser,
  LobbyPhase,
  LobbyPlayer,
  LobbyStatePayload,
  LobbyChatPayload,
  LobbyHostTransferPayload,
  LobbyScoreboardPayload,
  ScoreboardEntry,
} from "../../../shared/types"
import {
  lobbyChatPayloadSchema,
  heroSelectPayloadSchema,
  playerInputPayloadSchema,
  parseGameStateSyncPayload,
  parsePlayerDeathPayload,
} from "../../../shared/validators"
import {
  MAX_PLAYERS_PER_MATCH,
  MIN_PLAYERS_PER_MATCH,
  SCOREBOARD_COUNTDOWN_SEC,
  RECONNECT_WINDOW_MS,
  MATCH_COUNTDOWN_DURATION_MS,
  CLIENT_READY_TIMEOUT_MS,
  LOBBY_IDLE_TIMEOUT_MS,
  LOBBY_CHAT_BUFFER_MAX,
  LOBBY_DISPOSAL_GRACE_MS,
} from "../../../shared/balance-config/lobby"
import { DEFAULT_HERO_ID } from "../../../shared/balance-config/heroes"
import { logger } from "../../logger"
import { Equipment } from "../../game/components"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WebSocket close code passed to `Client.leave` when the host dissolves the lobby. */
export const CLOSE_CODE_LOBBY_DISSOLVED = 4012

/**
 * Client-scene-ready deadline. When `WIZARD_WARS_E2E=1`, `E2E_CLIENT_READY_TIMEOUT_MS`
 * may shorten the wait (clamped 100–15000 ms). Ignored in production unless the opt-in is set.
 */
function resolveClientReadyTimeoutMs(): number {
  if (process.env.WIZARD_WARS_E2E !== "1") {
    return CLIENT_READY_TIMEOUT_MS
  }
  const raw = process.env.E2E_CLIENT_READY_TIMEOUT_MS
  if (raw === undefined || raw === "") {
    return CLIENT_READY_TIMEOUT_MS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return CLIENT_READY_TIMEOUT_MS
  }
  return Math.min(15_000, Math.max(100, parsed))
}

/** Max lobby chat messages per player per rate-limit window. */
const CHAT_RATE_LIMIT = 3
/** Duration of the chat rate-limit window in ms. */
const CHAT_RATE_WINDOW_MS = 5_000
/** Max lobby chat message length in characters. */
const CHAT_MAX_LEN = 200

// ---------------------------------------------------------------------------
// Per-player state stored on `client.userData`
// ---------------------------------------------------------------------------

/**
 * Per-player data attached to `client.userData` throughout the session.
 * Persists across reconnects for the reconnect-grace window.
 */
export type PlayerData = {
  playerId: string
  username: string
  heroId: string
  isReady: boolean
  clientSceneReady: boolean
}

// ---------------------------------------------------------------------------
// Cross-lobby index
// ---------------------------------------------------------------------------

/**
 * Maps JWT `sub` → active `game_lobby` `roomId` to prevent a player from
 * simultaneously occupying two lobby seats. Cleared on leave/dispose, with
 * reconnect-grace caveats documented in `onDrop`.
 */
export const playerLobbyIndex = new Map<string, string>()

// ---------------------------------------------------------------------------
// Real-timer helpers
// ---------------------------------------------------------------------------

/**
 * Wraps `globalThis.setInterval` so lobby wall-clock intervals run even when
 * Colyseus stops ticking the simulation interval.
 *
 * @param cb - Callback fired every `ms` milliseconds.
 * @param ms - Interval period.
 * @returns Handle with a `.clear()` method.
 */
function nativeSetInterval(
  cb: () => void,
  ms: number,
): { clear: () => void } {
  const id = globalThis.setInterval(cb, ms)
  return { clear: () => globalThis.clearInterval(id) }
}

/**
 * Wraps `globalThis.setTimeout` so lobby wall-clock timeouts run even when
 * Colyseus stops ticking the simulation interval.
 *
 * @param cb - Callback fired once after `ms` milliseconds.
 * @param ms - Delay in milliseconds.
 * @returns Handle with a `.clear()` method.
 */
function nativeSetTimeout(
  cb: () => void,
  ms: number,
): { clear: () => void } {
  const id = globalThis.setTimeout(cb, ms)
  return { clear: () => globalThis.clearTimeout(id) }
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

/**
 * Colyseus `"game_lobby"` room for Wizard Wars.
 *
 * Manages the lobby FSM (`LOBBY` → `WAITING_FOR_CLIENTS` → `COUNTDOWN` →
 * `IN_PROGRESS` → `SCOREBOARD` → `LOBBY`), hero selection, chat, host
 * controls, reconnect-grace windows, and idle disposal.
 */
export class GameLobbyRoom extends Room {
  /**
   * Keeps the room alive briefly when empty so a transient disconnect does not
   * immediately destroy the lobby; see `LOBBY_DISPOSAL_GRACE_MS`.
   */
  autoDispose = false

  /** Current FSM phase — drives which handlers and broadcasts are active. */
  private lobbyPhase: LobbyPhase = "LOBBY"

  /** JWT `sub` of the current host; `null` when lobby is empty. */
  private hostPlayerId: string | null = null

  /** Stable join order used as host-transfer fallback priority. */
  private joinOrder: string[] = []

  /** Ring buffer of recent chat messages replayed to late joiners. */
  private chatBuffer: LobbyChatPayload[] = []

  /** Per-player chat rate-limit bookkeeping: `playerId → { count, windowStart }`. */
  private chatRateMap = new Map<string, { count: number; windowStart: number }>()

  /** Inactivity timeout → `dissolveLobby("lobby_expired")`. */
  private inactivityTimer: { clear: () => void } | null = null

  /** Pre-game countdown timer (per-tick during `COUNTDOWN` phase). */
  private countdownTimer: { clear: () => void } | null = null

  /** Timeout waiting for all clients to signal `client_scene_ready`. */
  private clientReadyTimer: { clear: () => void } | null = null

  /** Per-second scoreboard countdown timer. */
  private scoreboardTimer: { clear: () => void } | null = null

  /** Empty-lobby disposal grace timer. */
  private disposalGraceTimer: { clear: () => void } | null = null

  /**
   * Set of `playerId`s that have sent `client_scene_ready` during
   * `WAITING_FOR_CLIENTS`. Cleared on each new game start.
   */
  private clientReadySet = new Set<string>()

  /** Set of `playerId`s that have sent `lobby_return_to_lobby` during
   * `SCOREBOARD`. When the set covers all connected players the scoreboard
   * timer is skipped. Cleared on `returnToLobby`.
   */
  private returnedToLobbySet = new Set<string>()

  /** Active game simulation (null when not IN_PROGRESS). */
  private simulation: GameSimulation | null = null

  /** Simulation game loop interval. */
  private gameLoopTimer: { clear: () => void } | null = null

  /** Per-player session economies (userId → SessionEconomy). */
  private readonly economies = new Map<string, SessionEconomy>()

  /** Buffered inputs from clients for the current tick (userId → latest input). */
  private readonly inputBuffer = new Map<string, import("../../../shared/types").PlayerInputPayload>()

  // ---------------------------------------------------------------------------
  // Colyseus lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Handles uncaught exceptions from Colyseus lifecycle hooks.
   * Logs room id, phase, and client count alongside the error.
   *
   * @param err - The uncaught error.
   * @param methodName - Colyseus method that produced the error.
   */
  onUncaughtException(err: Error, methodName: string): void {
    logger.error(
      {
        event: "room.uncaught",
        roomId: this.roomId,
        phase: this.lobbyPhase,
        clients: this.clients.length,
        method: methodName,
        err,
      },
      "[GameLobbyRoom] unhandled error",
    )
  }

  /**
   * Colyseus `onCreate` hook.
   * Fixes `maxClients` to `MAX_PLAYERS_PER_MATCH`, seeds room metadata, starts
   * the inactivity timer, and registers all lobby message handlers.
   */
  async onCreate(): Promise<void> {
    this.maxClients = MAX_PLAYERS_PER_MATCH

    this.setMetadata({
      lobbyPhase: this.lobbyPhase,
      hostPlayerId: this.hostPlayerId,
      hostName: "",
      playerCount: 0,
      maxPlayers: MAX_PLAYERS_PER_MATCH,
    })

    this.resetInactivityTimer()
    this.registerLobbyHandlers()

    logger.info(
      { event: "room.created", roomId: this.roomId },
      "[GameLobbyRoom] created",
    )
  }

  /**
   * Colyseus `onAuth` hook.
   * Verifies the JWT token, rejects duplicate in-room sessions, enforces
   * capacity, and blocks players already seated in a different lobby.
   *
   * @param _client - Connecting client (unused pre-auth).
   * @param options - Connection options; must include `token`.
   * @returns Verified `AuthUser` attached to the client session.
   * @throws If auth fails, token is missing, lobby is full, or the player is
   *   already in another lobby.
   */
  async onAuth(
    _client: Client,
    options: { token?: string },
  ): Promise<AuthUser> {
    const token = options?.token
    if (!token) throw new Error("missing token")

    const auth = await verifyToken(token)

    for (const c of this.clients) {
      const pd = c.userData as PlayerData | undefined
      if (pd?.playerId === auth.sub) {
        throw new Error("duplicate session")
      }
    }

    if (this.clients.length >= this.maxClients) {
      throw new Error("lobby is full")
    }

    const existingRoom = playerLobbyIndex.get(auth.sub)
    if (existingRoom && existingRoom !== this.roomId) {
      throw new Error("already in another lobby")
    }

    return auth
  }

  /**
   * Colyseus `onJoin` hook.
   * Cancels the disposal grace timer, assigns `PlayerData`, registers the
   * player as host if the lobby is empty, updates `playerLobbyIndex`, and
   * sends the lobby state + chat history to the joining client.
   *
   * @param client - The joining client.
   * @param _options - Unused join options.
   * @param auth - Verified auth data returned from `onAuth`.
   */
  onJoin(client: Client, _options: unknown, auth: AuthUser): void {
    if (this.disposalGraceTimer) {
      this.disposalGraceTimer.clear()
      this.disposalGraceTimer = null
    }

    const pd: PlayerData = {
      playerId: auth.sub,
      username: auth.username,
      heroId: DEFAULT_HERO_ID,
      isReady: false,
      clientSceneReady: false,
    }
    client.userData = pd
    this.joinOrder.push(auth.sub)
    playerLobbyIndex.set(auth.sub, this.roomId)

    if (!this.hostPlayerId) {
      this.hostPlayerId = auth.sub
      this.setMetadata({ hostName: auth.username })
    }

    const joinPayload = { playerId: auth.sub, username: auth.username }
    client.send(RoomEvent.PlayerJoin, joinPayload)
    this.broadcast(RoomEvent.PlayerJoin, joinPayload, { except: client })

    client.send(RoomEvent.LobbyState, this.buildLobbyState())
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState(), {
      except: client,
    })
    client.send(RoomEvent.LobbyChatHistory, { messages: this.chatBuffer })

    this.updateMetadataPlayerCount()
    this.resetInactivityTimer()

    logger.info(
      { event: "player.join", roomId: this.roomId, playerId: auth.sub },
      "[GameLobbyRoom] player joined",
    )
  }

  /**
   * Colyseus `onDrop` hook.
   * Grants a reconnect-grace window (`RECONNECT_WINDOW_MS`) during active
   * game phases. In `LOBBY`, drops straight to `handlePlayerGone` and clears
   * `playerLobbyIndex` so the player can join another lobby immediately.
   *
   * @param client - The dropped client.
   */
  async onDrop(client: Client): Promise<void> {
    const pd = client.userData as PlayerData | undefined
    if (!pd) return

    if (
      this.lobbyPhase === "IN_PROGRESS" ||
      this.lobbyPhase === "SCOREBOARD" ||
      this.lobbyPhase === "COUNTDOWN" ||
      this.lobbyPhase === "WAITING_FOR_CLIENTS"
    ) {
      // Clear immediately so the account can join another lobby while this seat
      // is held for reconnect; onReconnect restores the index when they return.
      playerLobbyIndex.delete(pd.playerId)
      void this.allowReconnection(client, RECONNECT_WINDOW_MS / 1000).catch(
        (err) => {
          logger.warn(
            { event: "room.reconnect.timeout", roomId: this.roomId, playerId: pd.playerId, err },
            "[GameLobbyRoom] reconnection window expired",
          )
          this.handlePlayerGone(pd)
        },
      )
    } else {
      this.handlePlayerGone(pd)
    }
  }

  /**
   * Colyseus `onReconnect` hook.
   * Restores `playerLobbyIndex`, replays join and state payloads, and
   * re-evaluates the `clientReadySet` in case the player reconnects during
   * `WAITING_FOR_CLIENTS`.
   *
   * @param client - The reconnecting client.
   */
  onReconnect(client: Client): void {
    const pd = client.userData as PlayerData | undefined
    if (!pd) return

    playerLobbyIndex.set(pd.playerId, this.roomId)

    const joinPayload = { playerId: pd.playerId, username: pd.username }
    client.send(RoomEvent.PlayerJoin, joinPayload)
    this.broadcast(RoomEvent.PlayerJoin, joinPayload, { except: client })

    client.send(RoomEvent.LobbyState, this.buildLobbyState())
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState(), {
      except: client,
    })
    client.send(RoomEvent.LobbyChatHistory, { messages: this.chatBuffer })

    this.updateMetadataPlayerCount()

    logger.info(
      { event: "player.reconnect", roomId: this.roomId, playerId: pd.playerId },
      "[GameLobbyRoom] player reconnected",
    )
  }

  /**
   * Colyseus `onLeave` hook (clean disconnect path).
   * Delegates to `handlePlayerGone` for cleanup.
   *
   * @param client - The leaving client.
   */
  onLeave(client: Client): void {
    const pd = client.userData as PlayerData | undefined
    if (!pd) return
    this.handlePlayerGone(pd)
  }

  /**
   * Colyseus `onDispose` hook.
   * Removes all `playerLobbyIndex` entries tied to this room and clears every
   * active timer.
   */
  onDispose(): void {
    for (const playerId of this.joinOrder) {
      if (playerLobbyIndex.get(playerId) === this.roomId) {
        playerLobbyIndex.delete(playerId)
      }
    }
    this.inactivityTimer?.clear()
    this.countdownTimer?.clear()
    this.clientReadyTimer?.clear()
    this.scoreboardTimer?.clear()
    this.disposalGraceTimer?.clear()

    logger.info(
      { event: "room.disposed", roomId: this.roomId },
      "[GameLobbyRoom] disposed",
    )
  }

  // ---------------------------------------------------------------------------
  // Internal player lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Shared cleanup path for a player who has fully left the room (not
   * temporarily dropped). Removes `playerLobbyIndex`, transfers host if
   * needed, broadcasts leave events, and schedules disposal grace when the
   * lobby is empty.
   *
   * @param pd - The departing player's data.
   */
  private handlePlayerGone(pd: PlayerData): void {
    if (playerLobbyIndex.get(pd.playerId) === this.roomId) {
      playerLobbyIndex.delete(pd.playerId)
    }

    this.clientReadySet.delete(pd.playerId)
    this.returnedToLobbySet.delete(pd.playerId)
    this.chatRateMap.delete(pd.playerId)

    this.broadcast(RoomEvent.PlayerLeave, { playerId: pd.playerId })

    if (pd.playerId === this.hostPlayerId) {
      this.transferHost()
    }

    this.joinOrder = this.joinOrder.filter((id) => id !== pd.playerId)
    this.updateMetadataPlayerCount()

    if (this.lobbyPhase === "WAITING_FOR_CLIENTS") {
      this.checkAllClientsReady()
    }

    if (this.lobbyPhase === "SCOREBOARD") {
      this.checkAllReturnedToLobby()
    }

    if (this.clients.length === 0 && this.lobbyPhase === "LOBBY") {
      this.disposalGraceTimer = nativeSetTimeout(() => {
        if (this.clients.length === 0) {
          this.disconnect()
        }
      }, LOBBY_DISPOSAL_GRACE_MS)
    }

    logger.info(
      { event: "player.gone", roomId: this.roomId, playerId: pd.playerId },
      "[GameLobbyRoom] player gone",
    )
  }

  // ---------------------------------------------------------------------------
  // Message handlers
  // ---------------------------------------------------------------------------

  /**
   * Registers all `onMessage` handlers for lobby and game events.
   * A wildcard handler bumps the inactivity timer on any incoming message.
   */
  private registerLobbyHandlers(): void {
    this.onMessage(RoomEvent.LobbyChat, (client: Client, payload: unknown) => {
      this.handleChat(client, payload)
    })

    this.onMessage(RoomEvent.LobbyHeroSelect, (client: Client, payload: unknown) => {
      this.handleHeroSelect(client, payload)
    })

    this.onMessage(RoomEvent.LobbyStartGame, (client: Client) => {
      this.handleStartGame(client)
    })

    this.onMessage(RoomEvent.LobbyEndGame, (client: Client) => {
      this.handleEndGame(client)
    })

    this.onMessage(RoomEvent.ClientSceneReady, (client: Client) => {
      this.handleClientSceneReady(client)
    })

    this.onMessage(RoomEvent.LobbyReturnToLobby, (client: Client) => {
      this.handleReturnToLobby(client)
    })

    this.onMessage(RoomEvent.LobbyEndLobby, (client: Client) => {
      this.handleEndLobby(client)
    })

    this.onMessage(RoomEvent.RequestResync, (client: Client) => {
      this.handleRequestResync(client)
    })

    this.onMessage(RoomEvent.PlayerInput, (client: Client, payload: unknown) => {
      this.handlePlayerInput(client, payload)
    })

    this.onMessage(RoomEvent.ShopPurchase, (client: Client, payload: unknown) => {
      this.handleShopPurchase(client, payload)
    })

    this.onMessage("*", () => {
      this.resetInactivityTimer()
    })
  }

  /**
   * Buffers player input for the next simulation tick.
   *
   * @param client - The sending client.
   * @param payload - Raw inbound payload; validated with playerInputPayloadSchema.
   */
  private handlePlayerInput(client: Client, payload: unknown): void {
    if (this.lobbyPhase !== "IN_PROGRESS" || !this.simulation) return
    const pd = client.userData as PlayerData
    const result = playerInputPayloadSchema.safeParse(payload)
    if (!result.success) return
    this.inputBuffer.set(pd.playerId, result.data)
  }

  /**
   * Handles a shop purchase request from a player.
   *
   * @param client - The purchasing client.
   * @param payload - Raw inbound payload with itemId.
   */
  private handleShopPurchase(client: Client, payload: unknown): void {
    if (this.lobbyPhase !== "IN_PROGRESS") return
    const pd = client.userData as PlayerData
    const economy = this.economies.get(pd.playerId)
    if (!economy) return
    const itemId = (payload as { itemId?: string })?.itemId
    if (!itemId) return

    const result = attemptPurchase(economy, itemId)
    if (!result.success) {
      client.send(RoomEvent.ShopError, { reason: result.reason })
      return
    }

    // Apply item to simulation if applicable (axe equip, swift boots)
    const sim = this.simulation
    if (sim && itemId === "axe") {
      const eid = sim.playerEntityMap.get(pd.playerId)
      if (eid !== undefined) {
        Equipment.hasAxe[eid] = 1
      }
    }
    if (sim && itemId === "swift_boots") {
      const eid = sim.playerEntityMap.get(pd.playerId)
      if (eid !== undefined) {
        Equipment.hasSwiftBoots[eid] = 1
      }
    }

    client.send(RoomEvent.ShopState, buildShopStatePayload(economy))
  }

  /**
   * Handles an inbound `lobby_chat` message.
   * Validates the payload, enforces the rate limit (3 msgs / 5 s) and 200-char
   * cap, buffers the message, then broadcasts it to all clients.
   *
   * @param client - The sending client.
   * @param payload - Raw inbound payload; validated with `lobbyChatPayloadSchema`.
   */
  private handleChat(client: Client, payload: unknown): void {
    const parsed = lobbyChatPayloadSchema.safeParse(payload)
    if (!parsed.success) return

    const text = parsed.data.text.slice(0, CHAT_MAX_LEN)
    const pd = client.userData as PlayerData

    if (!this.checkChatRateLimit(pd.playerId)) {
      client.send(RoomEvent.LobbyError, { message: "chat rate limit exceeded" })
      return
    }

    const msg: LobbyChatPayload = {
      id: randomUUID(),
      userId: pd.playerId,
      username: pd.username,
      text,
      createdAt: new Date().toISOString(),
    }

    this.chatBuffer.push(msg)
    if (this.chatBuffer.length > LOBBY_CHAT_BUFFER_MAX) {
      this.chatBuffer.shift()
    }

    this.broadcast(RoomEvent.LobbyChat, msg)
    this.resetInactivityTimer()
  }

  /**
   * Handles an inbound `lobby_hero_select` message.
   * Only accepted in `LOBBY` phase. Validates the hero id, persists it to
   * `PlayerData`, and broadcasts the selection to all clients.
   *
   * @param client - The selecting client.
   * @param payload - Raw inbound payload; validated with `heroSelectPayloadSchema`.
   */
  private handleHeroSelect(client: Client, payload: unknown): void {
    if (this.lobbyPhase !== "LOBBY") return

    const parsed = heroSelectPayloadSchema.safeParse(payload)
    if (!parsed.success) return

    const pd = client.userData as PlayerData
    pd.heroId = parsed.data.heroId

    this.broadcast(RoomEvent.LobbyHeroSelect, {
      playerId: pd.playerId,
      heroId: pd.heroId,
    })

    this.resetInactivityTimer()
  }

  /**
   * Handles an inbound `lobby_start_game` message.
   * Only the host may call this, only in `LOBBY` phase, and only when at least
   * `MIN_PLAYERS_PER_MATCH` player(s) are connected.
   *
   * @param client - The requesting client.
   */
  private handleStartGame(client: Client): void {
    const pd = client.userData as PlayerData
    if (pd.playerId !== this.hostPlayerId) return
    if (this.lobbyPhase !== "LOBBY") return
    if (this.clients.length < MIN_PLAYERS_PER_MATCH) {
      client.send(RoomEvent.LobbyError, { message: "not enough players" })
      return
    }
    this.beginWaitingForClients()
  }

  /**
   * Handles an inbound `lobby_end_game` message.
   * Only the host may call this, only during `IN_PROGRESS`. Transitions to
   * `SCOREBOARD` with empty entries and end reason `"host_ended"`.
   *
   * @param client - The requesting client.
   */
  private handleEndGame(client: Client): void {
    const pd = client.userData as PlayerData
    if (pd.playerId !== this.hostPlayerId) return
    if (this.lobbyPhase !== "IN_PROGRESS") return
    this.transitionToScoreboard("host_ended", [])
  }

  /**
   * Handles an inbound `client_scene_ready` message.
   * Only processed during `WAITING_FOR_CLIENTS`. Marks the player as ready and
   * checks whether all connected players are now ready.
   *
   * @param client - The client that finished loading the scene.
   */
  private handleClientSceneReady(client: Client): void {
    if (this.lobbyPhase !== "WAITING_FOR_CLIENTS") return

    const pd = client.userData as PlayerData
    pd.clientSceneReady = true
    this.clientReadySet.add(pd.playerId)

    this.checkAllClientsReady()
  }

  /**
   * Handles an inbound `lobby_return_to_lobby` message.
   * Any player may send this during `SCOREBOARD`. Once all connected players
   * have sent it the scoreboard countdown is cancelled and `returnToLobby` is
   * called immediately.
   *
   * @param client - The requesting client.
   */
  private handleReturnToLobby(client: Client): void {
    if (this.lobbyPhase !== "SCOREBOARD") return

    const pd = client.userData as PlayerData
    this.returnedToLobbySet.add(pd.playerId)
    this.checkAllReturnedToLobby()
  }

  /**
   * Handles an inbound `lobby_end_lobby` message.
   * Only the host may call this. If in `COUNTDOWN`, cancels the countdown;
   * otherwise dissolves the room entirely.
   *
   * @param client - The requesting client.
   */
  private handleEndLobby(client: Client): void {
    const pd = client.userData as PlayerData
    if (pd.playerId !== this.hostPlayerId) return

    if (this.lobbyPhase === "COUNTDOWN") {
      this.cancelPreGameCountdown()
      return
    }

    if (this.lobbyPhase === "LOBBY" || this.lobbyPhase === "SCOREBOARD") {
      this.dissolveLobby("lobby_dissolved")
    }
  }

  /**
   * Aborts an active match countdown and returns the room to `LOBBY` phase.
   */
  private cancelPreGameCountdown(): void {
    this.countdownTimer?.clear()
    this.countdownTimer = null
    this.lobbyPhase = "LOBBY"
    this.updateMetadataPhase()
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState())
    this.resetInactivityTimer()
  }

  /**
   * Handles an inbound `request_resync` message.
   * Sends the full lobby state and shop state to the requesting client.
   * Only processed during `IN_PROGRESS`.
   *
   * @param client - The requesting client.
   */
  private handleRequestResync(client: Client): void {
    if (this.lobbyPhase !== "IN_PROGRESS") return

    const pd = client.userData as PlayerData
    const economy = this.economies.get(pd.playerId)

    client.send(RoomEvent.LobbyState, this.buildLobbyState())
    if (economy) {
      client.send(RoomEvent.ShopState, buildShopStatePayload(economy))
    }
    if (this.simulation) {
      const gameStateSync = parseGameStateSyncPayload(
        this.simulation.buildGameStateSyncPayload(),
      )
      client.send(RoomEvent.GameStateSync, gameStateSync)
    }
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  /**
   * Checks and updates the chat rate limit for a given player.
   * Allows `CHAT_RATE_LIMIT` messages per `CHAT_RATE_WINDOW_MS` sliding window.
   *
   * @param playerId - The player to check.
   * @returns `true` if the message is allowed; `false` if rate limited.
   */
  private checkChatRateLimit(playerId: string): boolean {
    const now = Date.now()
    const entry = this.chatRateMap.get(playerId)

    if (!entry || now - entry.windowStart > CHAT_RATE_WINDOW_MS) {
      this.chatRateMap.set(playerId, { count: 1, windowStart: now })
      return true
    }

    if (entry.count >= CHAT_RATE_LIMIT) {
      return false
    }

    entry.count++
    return true
  }

  // ---------------------------------------------------------------------------
  // Lobby FSM
  // ---------------------------------------------------------------------------

  /**
   * Transitions from `LOBBY` to `WAITING_FOR_CLIENTS`.
   * Resets per-player `clientSceneReady` flags, broadcasts the new lobby state
   * (which signals clients to begin loading the arena scene), and starts the
   * `CLIENT_READY_TIMEOUT_MS` deadline.
   */
  private beginWaitingForClients(): void {
    this.lobbyPhase = "WAITING_FOR_CLIENTS"
    this.clientReadySet.clear()

    for (const c of this.clients) {
      const pd = c.userData as PlayerData
      pd.clientSceneReady = false
    }

    this.updateMetadataPhase()
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState())

    this.clientReadyTimer?.clear()
    this.clientReadyTimer = nativeSetTimeout(() => {
      if (this.lobbyPhase !== "WAITING_FOR_CLIENTS") return
      logger.warn(
        { event: "room.client_ready.timeout", roomId: this.roomId },
        "[GameLobbyRoom] client_scene_ready timeout — proceeding with available clients",
      )
      this.beginCountdown()
    }, resolveClientReadyTimeoutMs())

    logger.info(
      { event: "room.waiting_for_clients", roomId: this.roomId },
      "[GameLobbyRoom] waiting for clients",
    )
  }

  /**
   * Checks whether every connected client has sent `client_scene_ready`.
   * If so, cancels the client-ready timeout and advances to countdown.
   */
  private checkAllClientsReady(): void {
    if (this.lobbyPhase !== "WAITING_FOR_CLIENTS") return

    const connectedPlayerIds = new Set(
      [...this.clients].map((c) => (c.userData as PlayerData).playerId),
    )
    const allReady = [...connectedPlayerIds].every((id) =>
      this.clientReadySet.has(id),
    )

    if (allReady) {
      this.clientReadyTimer?.clear()
      this.clientReadyTimer = null
      this.beginCountdown()
    }
  }

  /**
   * Transitions from `WAITING_FOR_CLIENTS` to `COUNTDOWN`.
   * Broadcasts `MatchCountdownStart` with an absolute server timestamp so
   * clients can display a synced countdown without per-second server pings,
   * then fires `MatchGo` + `IN_PROGRESS` after `MATCH_COUNTDOWN_DURATION_MS`.
   */
  private beginCountdown(): void {
    this.lobbyPhase = "COUNTDOWN"
    this.updateMetadataPhase()
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState())

    const startAtServerTimeMs = Date.now()
    this.broadcast(RoomEvent.MatchCountdownStart, {
      startAtServerTimeMs,
      durationMs: MATCH_COUNTDOWN_DURATION_MS,
    })

    this.countdownTimer?.clear()
    this.countdownTimer = nativeSetTimeout(() => {
      this.countdownTimer = null
      this.startGame()
    }, MATCH_COUNTDOWN_DURATION_MS)

    logger.info(
      {
        event: "room.countdown",
        roomId: this.roomId,
        startAtServerTimeMs,
        durationMs: MATCH_COUNTDOWN_DURATION_MS,
      },
      "[GameLobbyRoom] match countdown started",
    )
  }

  /**
   * Transitions from `COUNTDOWN` to `IN_PROGRESS`.
   * Broadcasts `MatchGo` and the updated lobby state. The actual game
   * simulation should be started by the caller or an injected system.
   */
  private startGame(): void {
    this.lobbyPhase = "IN_PROGRESS"
    this.updateMetadataPhase()
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState())

    // Create the game simulation and session economies for all players
    const nowMs = Date.now()
    this.simulation = createGameSimulation(nowMs)
    const spawnIndices = shuffle([...Array(ARENA_SPAWN_POINTS.length).keys()])
    let spawnIdx = 0
    for (const client of this.clients) {
      const pd = client.userData as PlayerData
      const economy = createSessionEconomy()
      this.economies.set(pd.playerId, economy)
      const idx = spawnIndices[spawnIdx++ % spawnIndices.length]
      this.simulation.addPlayer(pd.playerId, pd.username, pd.heroId, idx)
      // Seed each client with its starting shop state so the shop modal shows
      // correct gold + default ability-0 assignment immediately on MatchGo,
      // without requiring a request_resync or a first purchase.
      client.send(RoomEvent.ShopState, buildShopStatePayload(economy))
    }

    const gameStateSync = parseGameStateSyncPayload(this.simulation.buildGameStateSyncPayload())
    this.broadcast(RoomEvent.MatchGo, {})
    this.broadcast(RoomEvent.GameStateSync, gameStateSync)

    // Start the 20 Hz game loop
    this.gameLoopTimer = nativeSetInterval(() => {
      this.runGameTick()
    }, TICK_MS)

    logger.info(
      { event: "room.in_progress", roomId: this.roomId },
      "[GameLobbyRoom] match in progress",
    )
  }

  /**
   * Transitions from `IN_PROGRESS` to `SCOREBOARD`.
   * Broadcasts `LobbyScoreboard` with the provided entries, starts a
   * `SCOREBOARD_COUNTDOWN_SEC` per-second countdown, then calls
   * `returnToLobby` when the countdown reaches zero.
   *
   * @param endReason - Why the match ended (`"lives_depleted"`, `"host_ended"`, or `"time_cap"`).
   * @param entries - Scoreboard entries collected from the match system.
   */
  transitionToScoreboard(
    endReason: LobbyScoreboardPayload["endReason"],
    entries: ScoreboardEntry[],
  ): void {
    // Stop the game loop
    this.gameLoopTimer?.clear()
    this.gameLoopTimer = null
    this.simulation = null
    this.inputBuffer.clear()

    this.lobbyPhase = "SCOREBOARD"
    this.returnedToLobbySet.clear()
    this.updateMetadataPhase()
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState())

    const scorePayload: LobbyScoreboardPayload = { entries, endReason }
    this.broadcast(RoomEvent.LobbyScoreboard, scorePayload)

    let remaining = SCOREBOARD_COUNTDOWN_SEC
    this.scoreboardTimer?.clear()
    this.scoreboardTimer = nativeSetInterval(() => {
      remaining--
      this.broadcast(RoomEvent.LobbyScoreboardCountdown, { remaining })
      if (remaining <= 0) {
        this.scoreboardTimer?.clear()
        this.scoreboardTimer = null
        this.returnToLobby()
      }
    }, 1000)

    logger.info(
      { event: "room.scoreboard", roomId: this.roomId, endReason },
      "[GameLobbyRoom] scoreboard phase",
    )
  }

  /**
   * Transitions from `SCOREBOARD` back to `LOBBY`.
   * Clears all active match timers, resets per-player `clientSceneReady` and
   * `returnedToLobby` tracking, and broadcasts the new lobby state.
   */
  private returnToLobby(): void {
    this.scoreboardTimer?.clear()
    this.scoreboardTimer = null
    this.countdownTimer?.clear()
    this.countdownTimer = null
    this.clientReadyTimer?.clear()
    this.clientReadyTimer = null
    this.clientReadySet.clear()
    this.returnedToLobbySet.clear()

    for (const c of this.clients) {
      const pd = c.userData as PlayerData
      pd.clientSceneReady = false
      pd.isReady = false
    }

    this.lobbyPhase = "LOBBY"
    this.updateMetadataPhase()
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState())
    this.resetInactivityTimer()

    logger.info(
      { event: "room.return_to_lobby", roomId: this.roomId },
      "[GameLobbyRoom] returned to lobby",
    )
  }

  /**
   * Checks whether all connected players have voted to return to lobby.
   * If so, skips the remaining scoreboard timer and calls `returnToLobby`.
   */
  private checkAllReturnedToLobby(): void {
    if (this.lobbyPhase !== "SCOREBOARD") return

    const connectedCount = this.clients.length
    if (connectedCount > 0 && this.returnedToLobbySet.size >= connectedCount) {
      this.scoreboardTimer?.clear()
      this.scoreboardTimer = null
      this.returnToLobby()
    }
  }

  // ---------------------------------------------------------------------------
  // Public stub for match-end system
  // ---------------------------------------------------------------------------

  /**
   * Called by the external match-end system when the game reaches a terminal
   * state. Transitions the room to `SCOREBOARD` with the provided entries.
   *
   * @param entries - Final scoreboard entries from the match system.
   * @param endReason - Why the match ended.
   */
  notifyMatchEnd(
    entries: ScoreboardEntry[],
    endReason: LobbyScoreboardPayload["endReason"] = "lives_depleted",
  ): void {
    if (this.lobbyPhase !== "IN_PROGRESS") return
    this.transitionToScoreboard(endReason, entries)
  }

  // ---------------------------------------------------------------------------
  // Host management
  // ---------------------------------------------------------------------------

  /**
   * Transfers host to the next player in stable join order.
   * If no players remain, clears `hostPlayerId`. Broadcasts
   * `LobbyHostTransfer` and updates room metadata with the new host name.
   */
  private transferHost(): void {
    const connectedIds = new Set(
      [...this.clients]
        .map((c) => (c.userData as PlayerData)?.playerId)
        .filter(Boolean),
    )
    const remaining = this.joinOrder.filter((id) => connectedIds.has(id))

    if (remaining.length === 0) {
      this.hostPlayerId = null
      this.setMetadata({ hostPlayerId: null, hostName: "" })
      return
    }

    const newHostId = remaining[0]
    this.hostPlayerId = newHostId

    const newHostClient = [...this.clients].find(
      (c) => (c.userData as PlayerData)?.playerId === newHostId,
    )
    const newHostUsername =
      (newHostClient?.userData as PlayerData)?.username ?? "Unknown"

    const payload: LobbyHostTransferPayload = {
      hostPlayerId: newHostId,
      hostUsername: newHostUsername,
    }
    this.broadcast(RoomEvent.LobbyHostTransfer, payload)
    this.setMetadata({ hostPlayerId: newHostId, hostName: newHostUsername })

    logger.info(
      { event: "room.host_transfer", roomId: this.roomId, newHostId },
      "[GameLobbyRoom] host transferred",
    )
  }

  // ---------------------------------------------------------------------------
  // Lobby dissolution
  // ---------------------------------------------------------------------------

  /**
   * Kicks all clients and destroys the room.
   * Broadcasts `LobbyKicked` before leaving clients so the client can display
   * an appropriate message.
   *
   * @param reason - Reason sent in the `LobbyKicked` payload.
   */
  dissolveLobby(reason: "lobby_dissolved" | "lobby_expired"): void {
    this.broadcast(RoomEvent.LobbyKicked, { reason })
    for (const c of [...this.clients]) {
      c.leave(CLOSE_CODE_LOBBY_DISSOLVED)
    }
    this.disconnect()

    logger.info(
      { event: "room.dissolved", roomId: this.roomId, reason },
      "[GameLobbyRoom] dissolved",
    )
  }

  // ---------------------------------------------------------------------------
  // Game tick
  // ---------------------------------------------------------------------------

  /**
   * Runs one game simulation tick, broadcasts deltas and events to all clients.
   * Called at TICK_MS (50ms) intervals during IN_PROGRESS phase.
   */
  private runGameTick(): void {
    if (!this.simulation || this.lobbyPhase !== "IN_PROGRESS") {
      return
    }

    const serverTimeMs = Date.now()
    const inputMap = new Map(this.inputBuffer)
    const output = this.simulation.tick(inputMap, serverTimeMs)

    if (output.playerDeltas.length > 0 || output.fireballDeltas.length > 0 || output.fireballRemovedIds.length > 0) {
      this.broadcast(RoomEvent.PlayerBatchUpdate, {
        deltas: output.playerDeltas,
        removedIds: [],
        seq: 0,
      })
      if (output.fireballDeltas.length > 0 || output.fireballRemovedIds.length > 0) {
        this.broadcast(RoomEvent.FireballBatchUpdate, {
          deltas: output.fireballDeltas,
          removedIds: output.fireballRemovedIds,
          seq: 0,
        })
      }
    }

    for (const launch of output.fireballLaunches) {
      this.broadcast(RoomEvent.FireballLaunch, launch)
    }
    for (const impact of output.fireballImpacts) {
      this.broadcast(RoomEvent.FireballImpact, impact)
    }
    for (const bolt of output.lightningBolts) {
      this.broadcast(RoomEvent.LightningBolt, bolt)
    }
    for (const swing of output.axeSwings) {
      this.broadcast(RoomEvent.AxeSwing, swing)
    }
    for (const death of output.playerDeaths) {
      this.broadcast(RoomEvent.PlayerDeath, parsePlayerDeathPayload(death))
    }
    for (const respawn of output.playerRespawns) {
      this.broadcast(RoomEvent.PlayerRespawn, respawn)
    }
    for (const float of output.damageFloats) {
      this.broadcast(RoomEvent.DamageFloat, float)
    }
    for (const goldUpdate of output.goldUpdates) {
      const client = this.findClientByUserId(goldUpdate.userId)
      if (client) {
        client.send(RoomEvent.GoldBalance, { gold: goldUpdate.gold })
      }
    }

    if (output.matchEnded) {
      this.transitionToScoreboard(output.matchEnded.reason, output.matchEnded.entries)
    }
  }

  /**
   * Finds a connected Colyseus client by userId (JWT sub).
   *
   * @param userId - The JWT sub to search for.
   * @returns The matching client, or undefined.
   */
  private findClientByUserId(userId: string): Client | undefined {
    return [...this.clients].find((c) => (c.userData as PlayerData)?.playerId === userId)
  }

  // ---------------------------------------------------------------------------
  // Timers

  /**
   * Resets the idle inactivity timer to `LOBBY_IDLE_TIMEOUT_MS`.
   * Any incoming message (via the `"*"` handler) and player joins bump it.
   * When it fires the lobby is dissolved with reason `"lobby_expired"`.
   */
  private resetInactivityTimer(): void {
    this.inactivityTimer?.clear()
    this.inactivityTimer = nativeSetTimeout(() => {
      this.dissolveLobby("lobby_expired")
    }, LOBBY_IDLE_TIMEOUT_MS)
  }

  // ---------------------------------------------------------------------------
  // Metadata helpers
  // ---------------------------------------------------------------------------

  /**
   * Syncs the Colyseus room metadata `lobbyPhase` field for browser-facing
   * lobby list endpoints.
   */
  private updateMetadataPhase(): void {
    this.setMetadata({ lobbyPhase: this.lobbyPhase })
  }

  /**
   * Syncs the full set of Colyseus room metadata fields for browser-facing
   * lobby list endpoints (`/api/lobbies`).
   */
  private updateMetadataPlayerCount(): void {
    this.setMetadata({
      lobbyPhase: this.lobbyPhase,
      hostPlayerId: this.hostPlayerId,
      playerCount: this.clients.length,
      maxPlayers: MAX_PLAYERS_PER_MATCH,
    })
  }

  // ---------------------------------------------------------------------------
  // State builders
  // ---------------------------------------------------------------------------

  /**
   * Constructs a `LobbyStatePayload` snapshot from current room state.
   * Sent to clients on join, reconnect, and every phase transition.
   *
   * @returns The current lobby state snapshot.
   */
  private buildLobbyState(): LobbyStatePayload {
    const players: LobbyPlayer[] = [...this.clients].map((c) => {
      const pd = c.userData as PlayerData
      return {
        playerId: pd.playerId,
        userId: pd.playerId,
        username: pd.username,
        heroId: pd.heroId,
        isReady: pd.isReady,
        isHost: pd.playerId === this.hostPlayerId,
      }
    })

    return {
      lobbyId: this.roomId,
      phase: this.lobbyPhase,
      players,
      hostPlayerId: this.hostPlayerId,
      maxPlayers: MAX_PLAYERS_PER_MATCH,
    }
  }

  // ---------------------------------------------------------------------------
  // Public accessors (testing / admin)
  // ---------------------------------------------------------------------------

  /**
   * Read-only accessor for the current lobby phase.
   * Intended for tests and admin introspection.
   */
  get phase(): LobbyPhase {
    return this.lobbyPhase
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fisher-Yates shuffle for spawn index permutation.
 *
 * @param arr - Array to shuffle in-place.
 * @returns The same shuffled array.
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
