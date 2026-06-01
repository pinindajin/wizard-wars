import { hasComponent, removeComponent } from "bitecs"
import { Room, type Client } from "colyseus"
import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"

import { verifyToken } from "../../auth"
import { createGameSimulation, type GameSimulation } from "../../game/simulation"
import { createSessionEconomy, attemptPurchase, buildShopStatePayload } from "../../gameserver/sessionShop"
import type { SessionEconomy } from "../../gameserver/sessionShop"
import { ABILITY_CONFIGS } from "../../../shared/balance-config/abilities"
import { TICK_MS } from "../../../shared/balance-config/rendering"
import { ARENA_SPAWN_POINTS } from "../../../shared/balance-config/arena"
import { RoomEvent } from "../../../shared/roomEvents"
import type {
  AuthUser,
  FireballBatchUpdatePayload,
  LobbyPhase,
  LobbyPlayer,
  LobbyStatePayload,
  LobbyChatPayload,
  LobbyHostTransferPayload,
  LobbyScoreboardPayload,
  PlayerDelta,
  ServerPerformanceStatusPayload,
  ScoreboardEntry,
} from "../../../shared/types"
import {
  lobbyChatPayloadSchema,
  heroSelectPayloadSchema,
  playerInputPayloadSchema,
  shopPurchasePayloadSchema,
  assignAbilityPayloadSchema,
  parseGameStateSyncPayload,
  parsePlayerDeathPayload,
  parseServerPerformanceStatusPayload,
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
  ADMIN_CLOSE_COUNTDOWN_MS,
} from "../../../shared/balance-config/lobby"
import { DEFAULT_HERO_ID } from "../../../shared/balance-config/heroes"
import { logger } from "../../logger"
import {
  AbilitySlots,
  Equipment,
  ABILITY_INDEX,
  JumpArc,
  Position,
  TerrainState,
  TERRAIN_KIND,
  Velocity,
} from "../../game/components"
import { CLOSE_CODE_ADMIN_CLOSED } from "../../../shared/constants"
import { terrainStateAtPosition } from "../../../shared/collision/terrainHazards"
import {
  classifyServerPerformance,
  serverPerformanceStatusKey,
  SERVER_PERFORMANCE_STATUS_MIN_INTERVAL_MS,
} from "../../../shared/performanceIndicators"
import {
  PERFORMANCE_STATUS_WINDOW_MS,
  resolveGamePerformanceConfig,
} from "../../game/performanceConfig"
import { mergeFireballBatch, mergePlayerBatch } from "../../game/networkBatching"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WebSocket close code passed to `Client.leave` when the host dissolves the lobby. */
export const CLOSE_CODE_LOBBY_DISSOLVED = 4012

const activeGameLoopRoomIds = new Set<string>()

export type AdminCloseLobbyInput = {
  readonly adminUserId: string
  readonly adminUsername: string
  readonly confirmed: boolean
}

export type AdminCloseLobbyResult =
  | {
      readonly status: "confirmation_required"
      readonly occupied: true
      readonly playerCount: number
      readonly lobbyPhase: LobbyPhase
    }
  | {
      readonly status: "closed"
      readonly occupied: false
      readonly closeAtServerMs: null
    }
  | {
      readonly status: "closing"
      readonly occupied: true
      readonly closeAtServerMs: number
      readonly countdownMs: number
    }

export type AdminLobbyPlayerConnectionStatus = "connected" | "disconnected"
export type AdminLobbyPlayerPlayStatus = "lobby_only" | "loading_game" | "in_game" | "scoreboard"

export type AdminLobbyBandwidthSnapshot = {
  readonly inboundBytes: number
  readonly outboundBytes: number
  readonly totalBytes: number
}

export type AdminLobbyPlayerSnapshot = {
  readonly playerId: string
  readonly username: string
  readonly heroId: string
  readonly isHost: boolean
  readonly isReady: boolean
  readonly clientSceneReady: boolean
  readonly connectionStatus: AdminLobbyPlayerConnectionStatus
  readonly playStatus: AdminLobbyPlayerPlayStatus
  readonly lastSeenAt: string
}

export type AdminLobbySnapshot = {
  readonly snapshotAvailable: true
  readonly lobbyId: string
  readonly phase: LobbyPhase
  readonly createdAt: string
  readonly uptimeMs: number
  readonly connectedPlayerCount: number
  readonly rosterPlayerCount: number
  readonly maxPlayers: number
  readonly hostPlayerId: string | null
  readonly hostName: string
  readonly bandwidth: AdminLobbyBandwidthSnapshot
  readonly players: readonly AdminLobbyPlayerSnapshot[]
}

type AdminRosterEntry = PlayerData & {
  connectionStatus: AdminLobbyPlayerConnectionStatus
  lastSeenAtMs: number
}

type RawSender = Client["raw"]

type MessageSource = {
  on: (event: "message", listener: (data: unknown) => void) => void
  off?: (event: "message", listener: (data: unknown) => void) => void
  removeListener?: (event: "message", listener: (data: unknown) => void) => void
}

type BandwidthInstrumentedClient = Client & {
  raw: RawSender
  ref?: MessageSource
}

type BandwidthClientHooks = {
  readonly originalRaw: RawSender
  readonly onMessage: (data: unknown) => void
}

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

/**
 * Lobby idle duration. Under Vitest, `WIZARD_WARS_TEST_LOBBY_IDLE_MS` may shorten
 * the window for integration tests (clamped 100..LOBBY_IDLE_TIMEOUT_MS).
 */
function resolveLobbyIdleTimeoutMs(): number {
  if (process.env.VITEST !== "true") {
    return LOBBY_IDLE_TIMEOUT_MS
  }
  const raw = process.env.WIZARD_WARS_TEST_LOBBY_IDLE_MS
  if (raw === undefined || raw === "") {
    return LOBBY_IDLE_TIMEOUT_MS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return LOBBY_IDLE_TIMEOUT_MS
  }
  return Math.min(LOBBY_IDLE_TIMEOUT_MS, Math.max(100, parsed))
}

function resolveAdminCloseCountdownMs(): number {
  if (process.env.VITEST !== "true" && process.env.WIZARD_WARS_E2E !== "1") {
    return ADMIN_CLOSE_COUNTDOWN_MS
  }
  const raw = process.env.WIZARD_WARS_TEST_ADMIN_CLOSE_MS
  if (raw === undefined || raw === "") {
    return ADMIN_CLOSE_COUNTDOWN_MS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return ADMIN_CLOSE_COUNTDOWN_MS
  }
  return Math.min(ADMIN_CLOSE_COUNTDOWN_MS, Math.max(100, parsed))
}

/** Max lobby chat messages per player per rate-limit window. */
const CHAT_RATE_LIMIT = 3
/** Duration of the chat rate-limit window in ms. */
const CHAT_RATE_WINDOW_MS = 5_000
/** Max lobby chat message length in characters. */
const CHAT_MAX_LEN = 200

/**
 * Max queued `PlayerInput` payloads per player. Bound this so a misbehaving
 * client cannot consume unbounded memory by flooding the input channel; when
 * the cap is reached, the oldest entries are dropped first.
 */
const INPUT_QUEUE_CAP_PER_PLAYER = 32

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

/**
 * Returns byte length for WebSocket payload shapes used by `ws`.
 *
 * @param value - Raw message or outbound buffer.
 * @returns Number of payload bytes represented by the value.
 */
function rawPayloadByteLength(value: unknown): number {
  if (typeof value === "string") {
    return Buffer.byteLength(value)
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, part) => sum + rawPayloadByteLength(part), 0)
  }
  return 0
}

/**
 * Converts lobby phase into the dashboard's coarse player play status.
 *
 * @param phase - Current lobby FSM phase.
 * @returns Dashboard play status for players in the room.
 */
function adminPlayStatusForPhase(phase: LobbyPhase): AdminLobbyPlayerPlayStatus {
  if (phase === "LOBBY") return "lobby_only"
  if (phase === "WAITING_FOR_CLIENTS" || phase === "COUNTDOWN") return "loading_game"
  if (phase === "IN_PROGRESS") return "in_game"
  return "scoreboard"
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

  /** Inactivity timeout → `dissolveLobby("lobby_expired")` (only armed in `LOBBY`). */
  private inactivityTimer: { clear: () => void } | null = null

  /**
   * When the current lobby idle timer will fire (`Date.now()` + duration);
   * surfaced to clients as `lobbyIdleExpiresAtServerMs`. Cleared when not in
   * `LOBBY` or when idle is cleared.
   */
  private lobbyIdleDeadlineMs: number | null = null

  /** Pre-game countdown timer (per-tick during `COUNTDOWN` phase). */
  private countdownTimer: { clear: () => void } | null = null

  /** Timeout waiting for all clients to signal `client_scene_ready`. */
  private clientReadyTimer: { clear: () => void } | null = null

  /** Per-second scoreboard countdown timer. */
  private scoreboardTimer: { clear: () => void } | null = null

  /** Empty-lobby disposal grace timer. */
  private disposalGraceTimer: { clear: () => void } | null = null

  /** Final admin-close timer; only armed after the close notice is broadcast. */
  private adminCloseTimer: { clear: () => void } | null = null

  /** True once an admin close has begun. Freezes gameplay/lobby mutation. */
  private isAdminClosing = false

  /** Cached notice for reconnecting clients during the admin-close countdown. */
  private adminClosePayload: import("../../../shared/types").LobbyAdminClosingPayload | null = null

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

  /**
   * Ordered per-player input queue. Each `handlePlayerInput` pushes the
   * validated payload sorted by `seq`; `runGameTick` pops exactly one input
   * per player per tick (see `simulation.tick` semantics). Capped per
   * {@link INPUT_QUEUE_CAP_PER_PLAYER} to bound memory if a client floods.
   */
  private readonly inputQueue = new Map<
    string,
    import("../../../shared/types").PlayerInputPayload[]
  >()

  /** Runtime knobs for network cadence and performance reporting. */
  private readonly performanceConfig = resolveGamePerformanceConfig()

  /** Pending player visual deltas awaiting the next network flush. */
  private pendingPlayerDeltaBatches: PlayerDelta[][] = []

  /** Pending fireball visual deltas/removals awaiting the next network flush. */
  private pendingFireballBatches: Array<
    Pick<FireballBatchUpdatePayload, "deltas" | "removedIds">
  > = []

  /** Monotonic sequence for player batch payloads. */
  private playerBatchSeq = 0

  /** Monotonic sequence for fireball batch payloads. */
  private fireballBatchSeq = 0

  /** Last wall-clock time a cadence-limited network batch was flushed. */
  private lastNetworkFlushAtMs = 0

  /** Expected perf-clock time for the next loop callback. */
  private expectedNextTickAtPerfMs = 0

  /** Start of the current server performance aggregation window. */
  private performanceWindowStartedAtPerfMs = performance.now()

  /** CPU sample at the start of the current performance window. */
  private performanceWindowCpuStart = process.cpuUsage()

  private performanceDroppedDebtMs = 0
  private performanceCatchUpCallbacks = 0
  private performanceInputQueueDrops = 0
  private performanceSimDurationMs = 0
  private performanceBroadcastDurationMs = 0
  private performanceEventLoopLagMs = 0
  private lastPerformanceStatusKey = "nominal"
  private lastPerformanceStatusBroadcastAtMs = 0

  /**
   * Highest `seq` accepted from each player across the queue lifetime, used
   * to ignore duplicate / re-ordered inputs on arrival.
   */
  private readonly highestAcceptedSeqByPlayer = new Map<string, number>()

  /** Wall-clock timestamp used by admin dashboard uptime calculations. */
  private readonly adminCreatedAtMs = Date.now()

  /** Room lifetime inbound payload bytes observed after clients join this room. */
  private adminInboundBytes = 0

  /** Room lifetime outbound payload bytes emitted through client transports. */
  private adminOutboundBytes = 0

  /** Dashboard roster that keeps disconnected players during reconnect grace. */
  private readonly adminRoster = new Map<string, AdminRosterEntry>()

  /** Delayed in-progress simulation cleanup for players inside reconnect grace. */
  private readonly inProgressPlayerCleanupTimers = new Map<
    string,
    { clear: () => void }
  >()

  /** Transport hooks installed for per-room bandwidth accounting. */
  private readonly bandwidthClientHooks = new Map<Client, BandwidthClientHooks>()

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
        area: "netcode",
        side: "server",
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
      { event: "room.created", area: "netcode", side: "server", roomId: this.roomId },
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
    if (this.isAdminClosing) {
      throw new Error("lobby is closing")
    }

    const token = options?.token
    if (!token) {
      logger.warn(
        { event: "room.auth.rejected", area: "netcode", side: "server", roomId: this.roomId, reason: "missing_token" },
        "[GameLobbyRoom] auth rejected",
      )
      throw new Error("missing token")
    }

    let auth: AuthUser
    try {
      auth = await verifyToken(token)
    } catch (err) {
      logger.warn(
        { event: "room.auth.rejected", area: "netcode", side: "server", roomId: this.roomId, reason: "invalid_token", err },
        "[GameLobbyRoom] auth rejected",
      )
      throw err
    }
    // Future hardening: normal browser joins fetch tokens through `/api/auth/ws-token`,
    // which can DB-verify users when VERIFY_USER_ON_PROTECTED=true. If direct stale JWT
    // WebSocket joins become a real issue, add DB-backed user verification here too.

    for (const c of this.clients) {
      const pd = c.userData as PlayerData | undefined
      if (pd?.playerId === auth.sub) {
        logger.warn(
          {
            event: "room.auth.rejected",
            area: "netcode",
            side: "server",
            roomId: this.roomId,
            playerId: auth.sub,
            reason: "duplicate_session",
          },
          "[GameLobbyRoom] auth rejected",
        )
        throw new Error("duplicate session")
      }
    }

    if (this.clients.length >= this.maxClients) {
      logger.warn(
        {
          event: "room.auth.rejected",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: auth.sub,
          reason: "lobby_full",
          clients: this.clients.length,
        },
        "[GameLobbyRoom] auth rejected",
      )
      throw new Error("lobby is full")
    }

    const existingRoom = playerLobbyIndex.get(auth.sub)
    if (existingRoom && existingRoom !== this.roomId) {
      logger.warn(
        {
          event: "room.auth.rejected",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: auth.sub,
          reason: "already_in_another_lobby",
          existingRoom,
        },
        "[GameLobbyRoom] auth rejected",
      )
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
    this.clearInProgressPlayerCleanup(auth.sub)
    if (!this.joinOrder.includes(auth.sub)) {
      this.joinOrder.push(auth.sub)
    }
    playerLobbyIndex.set(auth.sub, this.roomId)
    this.installBandwidthHooks(client)
    this.markAdminPlayerConnected(pd)

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

    this.resetPlayerInputStreamForNewTransport(auth.sub)
    if (this.lobbyPhase === "IN_PROGRESS") {
      this.sendInProgressHydrationToClient(client, { includeLobbyState: false })
    }

    logger.info(
      {
        event: "room.player.join",
        area: "netcode",
        side: "server",
        roomId: this.roomId,
        playerId: auth.sub,
        sessionId: client.sessionId,
        phase: this.lobbyPhase,
      },
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
    this.removeBandwidthHooks(client)
    this.markAdminPlayerDisconnected(pd)

    if (this.isAdminClosing) {
      if (playerLobbyIndex.get(pd.playerId) === this.roomId) {
        playerLobbyIndex.delete(pd.playerId)
      }
      return
    }

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
            {
              event: "room.reconnect.timeout",
              area: "netcode",
              side: "server",
              roomId: this.roomId,
              playerId: pd.playerId,
              sessionId: client.sessionId,
              phase: this.lobbyPhase,
              err,
            },
            "[GameLobbyRoom] reconnection window expired",
          )
          this.handlePlayerGone(pd, { reconnectGraceElapsed: true })
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
    this.installBandwidthHooks(client)
    this.markAdminPlayerConnected(pd)

    if (this.isAdminClosing) {
      if (this.adminClosePayload) {
        client.send(RoomEvent.LobbyAdminClosing, this.adminClosePayload)
      }
      return
    }

    playerLobbyIndex.set(pd.playerId, this.roomId)
    this.clearInProgressPlayerCleanup(pd.playerId)

    const joinPayload = { playerId: pd.playerId, username: pd.username }
    client.send(RoomEvent.PlayerJoin, joinPayload)
    this.broadcast(RoomEvent.PlayerJoin, joinPayload, { except: client })

    client.send(RoomEvent.LobbyState, this.buildLobbyState())
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState(), {
      except: client,
    })
    client.send(RoomEvent.LobbyChatHistory, { messages: this.chatBuffer })

    this.updateMetadataPlayerCount()

    this.resetPlayerInputStreamForNewTransport(pd.playerId)
    if (this.lobbyPhase === "IN_PROGRESS") {
      this.sendInProgressHydrationToClient(client, { includeLobbyState: false })
    }

    logger.info(
      {
        event: "room.player.reconnect",
        area: "netcode",
        side: "server",
        roomId: this.roomId,
        playerId: pd.playerId,
        sessionId: client.sessionId,
        phase: this.lobbyPhase,
      },
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
    this.removeBandwidthHooks(client)
    if (this.isAdminClosing) {
      if (playerLobbyIndex.get(pd.playerId) === this.roomId) {
        playerLobbyIndex.delete(pd.playerId)
      }
      this.markAdminPlayerDisconnected(pd)
      return
    }
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
    this.clearLobbyIdleTimer()
    this.countdownTimer?.clear()
    this.clientReadyTimer?.clear()
    this.scoreboardTimer?.clear()
    this.disposalGraceTimer?.clear()
    this.adminCloseTimer?.clear()
    this.gameLoopTimer?.clear()
    this.clearInProgressPlayerCleanupTimers()
    this.clearMatchRuntimeState()
    this.clearBandwidthHooks()
    this.adminRoster.clear()

    logger.info(
      { event: "room.disposed", area: "netcode", side: "server", roomId: this.roomId },
      "[GameLobbyRoom] disposed",
    )
  }

  // ---------------------------------------------------------------------------
  // Internal player lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Adds transport hooks that count room-level inbound and outbound payload bytes.
   *
   * @param client - Colyseus client whose transport should be observed.
   */
  private installBandwidthHooks(client: Client): void {
    if (this.bandwidthClientHooks.has(client)) return

    const instrumented = client as BandwidthInstrumentedClient
    const originalRaw = instrumented.raw.bind(instrumented) as RawSender
    const onMessage = (data: unknown): void => {
      this.adminInboundBytes += rawPayloadByteLength(data)
    }

    instrumented.raw = ((...args: Parameters<RawSender>) => {
      this.adminOutboundBytes += rawPayloadByteLength(args[0])
      return originalRaw(...args)
    }) as RawSender
    instrumented.ref?.on("message", onMessage)
    this.bandwidthClientHooks.set(client, { originalRaw, onMessage })
  }

  /**
   * Removes transport hooks installed by {@link installBandwidthHooks}.
   *
   * @param client - Client whose bandwidth hooks should be removed.
   */
  private removeBandwidthHooks(client: Client): void {
    const hooks = this.bandwidthClientHooks.get(client)
    if (!hooks) return

    const instrumented = client as BandwidthInstrumentedClient
    instrumented.raw = hooks.originalRaw
    instrumented.ref?.off?.("message", hooks.onMessage)
    instrumented.ref?.removeListener?.("message", hooks.onMessage)
    this.bandwidthClientHooks.delete(client)
  }

  /**
   * Removes all active transport hooks when the room is disposed.
   */
  private clearBandwidthHooks(): void {
    for (const client of [...this.bandwidthClientHooks.keys()]) {
      this.removeBandwidthHooks(client)
    }
  }

  /**
   * Records a player as connected in the admin dashboard roster.
   *
   * @param pd - Player data attached to the active client.
   */
  private markAdminPlayerConnected(pd: PlayerData): void {
    this.adminRoster.set(pd.playerId, {
      ...pd,
      connectionStatus: "connected",
      lastSeenAtMs: Date.now(),
    })
  }

  /**
   * Records a player as temporarily disconnected during reconnect grace.
   *
   * @param pd - Player data attached to the dropped client.
   */
  private markAdminPlayerDisconnected(pd: PlayerData): void {
    this.adminRoster.set(pd.playerId, {
      ...pd,
      connectionStatus: "disconnected",
      lastSeenAtMs: Date.now(),
    })
  }

  /**
   * Cancels delayed simulation cleanup for one in-progress player.
   *
   * @param playerId - Player whose cleanup timer should be cleared.
   */
  private clearInProgressPlayerCleanup(playerId: string): void {
    const timer = this.inProgressPlayerCleanupTimers.get(playerId)
    if (!timer) return
    timer.clear()
    this.inProgressPlayerCleanupTimers.delete(playerId)
  }

  /** Cancels all delayed in-progress player cleanup timers. */
  private clearInProgressPlayerCleanupTimers(): void {
    for (const timer of this.inProgressPlayerCleanupTimers.values()) {
      timer.clear()
    }
    this.inProgressPlayerCleanupTimers.clear()
  }

  /**
   * Schedules in-progress player simulation cleanup after reconnect grace.
   *
   * @param playerId - Player whose simulation state should expire.
   */
  private scheduleInProgressPlayerCleanup(playerId: string): void {
    this.clearInProgressPlayerCleanup(playerId)
    this.inProgressPlayerCleanupTimers.set(
      playerId,
      nativeSetTimeout(() => {
        this.inProgressPlayerCleanupTimers.delete(playerId)
        if (this.clients.some((client) => {
          const pd = client.userData as PlayerData | undefined
          return pd?.playerId === playerId
        })) {
          return
        }
        this.removeInProgressPlayerState(playerId)
      }, RECONNECT_WINDOW_MS),
    )
  }

  /**
   * Removes a player from in-progress runtime state after reconnect grace.
   *
   * @param playerId - Player to remove from match runtime state.
   */
  private removeInProgressPlayerState(playerId: string): void {
    this.clearInProgressPlayerCleanup(playerId)
    this.simulation?.removePlayer(playerId)
    this.inputQueue.delete(playerId)
    this.highestAcceptedSeqByPlayer.delete(playerId)
    this.economies.delete(playerId)

    if (this.lobbyPhase === "IN_PROGRESS" && this.clients.length === 0) {
      this.gameLoopTimer?.clear()
      this.gameLoopTimer = null
      this.clearMatchRuntimeState()
      this.disposalGraceTimer = nativeSetTimeout(() => {
        if (this.clients.length === 0) {
          this.disconnect()
        }
      }, LOBBY_DISPOSAL_GRACE_MS)
    }
  }

  /**
   * Resets per-player input stream state when a client opens a new transport
   * (browser tab refresh) so the client can restart `seq` at 0. Clears
   * duplicate-drop bookkeeping and, when the sim still has the entity, resets
   * the simulation ack cursor.
   *
   * @param playerId - Joining or reconnecting user's id.
   */
  private resetPlayerInputStreamForNewTransport(playerId: string): void {
    if (this.lobbyPhase !== "IN_PROGRESS" || !this.simulation) return
    this.highestAcceptedSeqByPlayer.delete(playerId)
    this.inputQueue.delete(playerId)
    if (this.simulation.playerEntityMap.has(playerId)) {
      this.simulation.resetClientInputStream(playerId)
    }
  }

  /**
   * Shared cleanup path for a player who has fully left the room (not
   * temporarily dropped). Removes `playerLobbyIndex`, transfers host if
   * needed, broadcasts leave events, and schedules disposal grace when the
   * lobby is empty.
   *
   * @param pd - The departing player's data.
   */
  private handlePlayerGone(
    pd: PlayerData,
    opts?: { readonly reconnectGraceElapsed?: boolean },
  ): void {
    if (playerLobbyIndex.get(pd.playerId) === this.roomId) {
      playerLobbyIndex.delete(pd.playerId)
    }

    this.clientReadySet.delete(pd.playerId)
    this.returnedToLobbySet.delete(pd.playerId)
    this.chatRateMap.delete(pd.playerId)
    this.adminRoster.delete(pd.playerId)

    this.broadcast(RoomEvent.PlayerLeave, { playerId: pd.playerId })

    if (pd.playerId === this.hostPlayerId) {
      this.transferHost()
    }

    this.joinOrder = this.joinOrder.filter((id) => id !== pd.playerId)
    this.updateMetadataPlayerCount()

    if (this.lobbyPhase === "IN_PROGRESS" && this.simulation) {
      if (opts?.reconnectGraceElapsed) {
        this.removeInProgressPlayerState(pd.playerId)
      } else {
        this.scheduleInProgressPlayerCleanup(pd.playerId)
      }
    }

    if (this.lobbyPhase === "WAITING_FOR_CLIENTS") {
      this.checkAllClientsReady()
    }

    if (this.lobbyPhase === "SCOREBOARD") {
      this.checkAllReturnedToLobby()
    }

    if (this.clients.length === 0 && this.lobbyPhase === "LOBBY") {
      // No players remain; idle kick is meaningless and would fire on a ghost room.
      this.clearLobbyIdleTimer()
      this.disposalGraceTimer = nativeSetTimeout(() => {
        if (this.clients.length === 0) {
          this.disconnect()
        }
      }, LOBBY_DISPOSAL_GRACE_MS)
    }

    logger.info(
      {
        event: "room.player.gone",
        area: "netcode",
        side: "server",
        roomId: this.roomId,
        playerId: pd.playerId,
        phase: this.lobbyPhase,
      },
      "[GameLobbyRoom] player gone",
    )
  }

  // ---------------------------------------------------------------------------
  // Message handlers
  // ---------------------------------------------------------------------------

  /**
   * Registers all `onMessage` handlers for lobby and game events.
   * Typed handlers bump the lobby idle timer where they call
   * {@link GameLobbyRoom.resetInactivityTimer}. The `"*"` handler bumps idle
   * for message types without a dedicated handler (Colyseus-specific routing).
   */
  private registerLobbyHandlers(): void {
    this.onMessage(RoomEvent.LobbyChat, (client: Client, payload: unknown) => {
      if (this.isAdminClosing) return
      this.handleChat(client, payload)
    })

    this.onMessage(RoomEvent.LobbyHeroSelect, (client: Client, payload: unknown) => {
      if (this.isAdminClosing) return
      this.handleHeroSelect(client, payload)
    })

    this.onMessage(RoomEvent.LobbyStartGame, (client: Client) => {
      if (this.isAdminClosing) return
      this.handleStartGame(client)
    })

    this.onMessage(RoomEvent.LobbyEndGame, (client: Client) => {
      if (this.isAdminClosing) return
      this.handleEndGame(client)
    })

    this.onMessage(RoomEvent.ClientSceneReady, (client: Client) => {
      if (this.isAdminClosing) return
      this.handleClientSceneReady(client)
    })

    this.onMessage(RoomEvent.LobbyReturnToLobby, (client: Client) => {
      if (this.isAdminClosing) return
      this.handleReturnToLobby(client)
    })

    this.onMessage(RoomEvent.LobbyEndLobby, (client: Client) => {
      if (this.isAdminClosing) return
      this.handleEndLobby(client)
    })

    this.onMessage(RoomEvent.RequestResync, (client: Client) => {
      if (this.isAdminClosing) return
      this.handleRequestResync(client)
    })

    this.onMessage(RoomEvent.PlayerInput, (client: Client, payload: unknown) => {
      if (this.isAdminClosing) return
      this.handlePlayerInput(client, payload)
    })

    this.onMessage(RoomEvent.ShopPurchase, (client: Client, payload: unknown) => {
      if (this.isAdminClosing) return
      this.handleShopPurchase(client, payload)
    })

    this.onMessage(RoomEvent.AssignAbility, (client: Client, payload: unknown) => {
      if (this.isAdminClosing) return
      this.handleAssignAbility(client, payload)
    })

    if (process.env.WIZARD_WARS_E2E === "1") {
      this.onMessage("e2e_set_player_position", (client: Client, payload: unknown) => {
        if (this.isAdminClosing) return
        this.handleE2eSetPlayerPosition(client, payload)
      })
    }

    this.onMessage("*", () => {
      if (this.isAdminClosing) return
      this.resetInactivityTimer()
    })
  }

  /**
   * Enqueues player input for the simulation in `seq` order. Drops inputs
   * whose `seq` is less than or equal to the highest already accepted for
   * this player (handles re-order / duplicates). Caps the per-player queue
   * at {@link INPUT_QUEUE_CAP_PER_PLAYER} to bound memory.
   *
   * @param client - The sending client.
   * @param payload - Raw inbound payload; validated with playerInputPayloadSchema.
   */
  private handlePlayerInput(client: Client, payload: unknown): void {
    if (this.lobbyPhase !== "IN_PROGRESS" || !this.simulation) {
      const pd = client.userData as PlayerData | undefined
      logger.debug(
        {
          event: "room.player_input.rejected",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: pd?.playerId,
          sessionId: client.sessionId,
          phase: this.lobbyPhase,
          reason: "wrong_phase",
        },
        "[GameLobbyRoom] player input rejected",
      )
      return
    }
    const pd = client.userData as PlayerData
    const result = playerInputPayloadSchema.safeParse(payload)
    if (!result.success) {
      logger.debug(
        {
          event: "room.player_input.rejected",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: pd.playerId,
          sessionId: client.sessionId,
          phase: this.lobbyPhase,
          reason: "invalid_payload",
        },
        "[GameLobbyRoom] player input rejected",
      )
      return
    }

    const highest = this.highestAcceptedSeqByPlayer.get(pd.playerId) ?? -1
    if (result.data.seq <= highest) {
      logger.debug(
        {
          event: "room.player_input.dropped_duplicate",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: pd.playerId,
          sessionId: client.sessionId,
          phase: this.lobbyPhase,
          seq: result.data.seq,
          highest,
          reason: "stale_or_duplicate_seq",
        },
        "[GameLobbyRoom] player input dropped",
      )
      return
    }

    let queue = this.inputQueue.get(pd.playerId)
    if (!queue) {
      queue = []
      this.inputQueue.set(pd.playerId, queue)
    }
    queue.push(result.data)
    this.highestAcceptedSeqByPlayer.set(pd.playerId, result.data.seq)

    // Cap queue: drop from the front if it grows unbounded.
    while (queue.length > INPUT_QUEUE_CAP_PER_PLAYER) {
      queue.shift()
      this.performanceInputQueueDrops += 1
      logger.warn(
        {
          event: "room.player_input.queue_cap_drop",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: pd.playerId,
          sessionId: client.sessionId,
          phase: this.lobbyPhase,
          seq: result.data.seq,
          queueLength: queue.length,
          reason: "input_queue_cap",
        },
        "[GameLobbyRoom] player input queue capped",
      )
    }
  }

  /**
   * Repositions the requesting player for deterministic Playwright terrain tests.
   * Registered only when `WIZARD_WARS_E2E=1`; ignored outside live matches.
   *
   * @param client - Client whose player entity should move.
   * @param payload - Raw payload with numeric `x` and `y`.
   */
  private handleE2eSetPlayerPosition(client: Client, payload: unknown): void {
    if (process.env.WIZARD_WARS_E2E !== "1") return
    if (this.lobbyPhase !== "IN_PROGRESS" || !this.simulation) return

    const data = payload as { readonly x?: unknown; readonly y?: unknown } | null
    const x = typeof data?.x === "number" ? data.x : Number.NaN
    const y = typeof data?.y === "number" ? data.y : Number.NaN
    if (!Number.isFinite(x) || !Number.isFinite(y)) return

    const pd = client.userData as PlayerData | undefined
    if (!pd) return
    const eid = this.simulation.playerEntityMap.get(pd.playerId)
    if (eid === undefined) return

    Position.x[eid] = x
    Position.y[eid] = y
    Velocity.vx[eid] = 0
    Velocity.vy[eid] = 0
    if (hasComponent(this.simulation.world, eid, JumpArc)) {
      removeComponent(this.simulation.world, eid, JumpArc)
      JumpArc.z[eid] = 0
      JumpArc.vz[eid] = 0
      JumpArc.startedInLava[eid] = 0
    }

    TerrainState.kind[eid] = TERRAIN_KIND[terrainStateAtPosition(x, y)]
    TerrainState.lavaDamageCarry[eid] = 0
    this.sendInProgressHydrationToClient(client, { includeLobbyState: false })
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
    const parsed = shopPurchasePayloadSchema.safeParse(payload)
    if (!parsed.success) return
    const { itemId } = parsed.data

    const result = attemptPurchase(economy, itemId)
    if (!result.success) {
      client.send(RoomEvent.ShopError, { reason: result.reason })
      return
    }

    // Apply item to simulation if applicable (swift boots)
    const sim = this.simulation
    if (sim && itemId === "swift_boots") {
      const eid = sim.playerEntityMap.get(pd.playerId)
      if (eid !== undefined) {
        Equipment.hasSwiftBoots[eid] = 1
      }
    }
    this.syncAbilitySlotsToSimulation(pd.playerId, economy)

    client.send(RoomEvent.ShopState, buildShopStatePayload(economy))
  }

  /**
   * Handles ability-bar assignment for abilities the player already owns.
   *
   * @param client - The assigning client.
   * @param payload - Raw inbound payload with itemId and slotIndex.
   */
  private handleAssignAbility(client: Client, payload: unknown): void {
    if (this.lobbyPhase !== "IN_PROGRESS") return
    const pd = client.userData as PlayerData
    const economy = this.economies.get(pd.playerId)
    if (!economy) return

    const parsed = assignAbilityPayloadSchema.safeParse(payload)
    if (!parsed.success) return

    const { itemId, slotIndex } = parsed.data
    if (!ABILITY_CONFIGS[itemId]) {
      client.send(RoomEvent.ShopError, { reason: "Unknown ability" })
      return
    }
    if (!economy.ownedItemIds.has(itemId)) {
      client.send(RoomEvent.ShopError, { reason: "Ability not owned" })
      return
    }

    for (let i = 0; i < economy.abilitySlots.length; i++) {
      if (economy.abilitySlots[i] === itemId) {
        economy.abilitySlots[i] = null
      }
    }
    economy.abilitySlots[slotIndex] = itemId
    this.syncAbilitySlotsToSimulation(pd.playerId, economy)

    client.send(RoomEvent.ShopState, buildShopStatePayload(economy))
  }

  /**
   * Mirrors session economy ability-bar state into authoritative ECS slots.
   *
   * @param playerId - User id owning the entity.
   * @param economy - Source session economy state.
   */
  private syncAbilitySlotsToSimulation(
    playerId: string,
    economy: SessionEconomy,
  ): void {
    const eid = this.simulation?.playerEntityMap.get(playerId)
    if (eid === undefined) return

    const toIndex = (abilityId: string | null): number => {
      if (!abilityId) return -1
      if (!ABILITY_CONFIGS[abilityId]) return -1
      return ABILITY_INDEX[abilityId as keyof typeof ABILITY_INDEX] ?? -1
    }

    AbilitySlots.slot0[eid] = toIndex(economy.abilitySlots[0] ?? null)
    AbilitySlots.slot1[eid] = toIndex(economy.abilitySlots[1] ?? null)
    AbilitySlots.slot2[eid] = toIndex(economy.abilitySlots[2] ?? null)
    AbilitySlots.slot3[eid] = toIndex(economy.abilitySlots[3] ?? null)
    AbilitySlots.slot4[eid] = toIndex(economy.abilitySlots[4] ?? null)
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
    if (pd.playerId !== this.hostPlayerId) {
      logger.debug(
        {
          event: "room.start_game.rejected",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: pd.playerId,
          sessionId: client.sessionId,
          phase: this.lobbyPhase,
          reason: "not_host",
        },
        "[GameLobbyRoom] start game rejected",
      )
      return
    }
    if (this.lobbyPhase !== "LOBBY") {
      logger.debug(
        {
          event: "room.start_game.rejected",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: pd.playerId,
          sessionId: client.sessionId,
          phase: this.lobbyPhase,
          reason: "wrong_phase",
        },
        "[GameLobbyRoom] start game rejected",
      )
      return
    }
    if (this.clients.length < MIN_PLAYERS_PER_MATCH) {
      client.send(RoomEvent.LobbyError, { message: "not enough players" })
      logger.debug(
        {
          event: "room.start_game.rejected",
          area: "netcode",
          side: "server",
          roomId: this.roomId,
          playerId: pd.playerId,
          sessionId: client.sessionId,
          phase: this.lobbyPhase,
          reason: "not_enough_players",
          clients: this.clients.length,
        },
        "[GameLobbyRoom] start game rejected",
      )
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
   * During `IN_PROGRESS`, unicasts fresh `LobbyState`, optional `ShopState`, and
   * `GameStateSync` so clients can recover after refresh or missed messages.
   *
   * @param client - The requesting client.
   */
  private handleRequestResync(client: Client): void {
    const pd = client.userData as PlayerData | undefined
    logger.debug(
      {
        event: "room.resync.requested",
        area: "netcode",
        side: "server",
        roomId: this.roomId,
        playerId: pd?.playerId,
        sessionId: client.sessionId,
        phase: this.lobbyPhase,
      },
      "[GameLobbyRoom] resync requested",
    )
    this.sendInProgressHydrationToClient(client, { includeLobbyState: true })
  }

  /**
   * Unicasts match hydration (`ShopState`, `GameStateSync`) to one client while
   * the room is `IN_PROGRESS`. Used on join/reconnect and from
   * {@link handleRequestResync}.
   *
   * @param client - Target client (must carry {@link PlayerData}).
   * @param opts - When `includeLobbyState` is true, sends `LobbyState` first
   *   (explicit resync). Join/reconnect pass false because `onJoin` /
   *   `onReconnect` already sent lobby state.
   */
  private sendInProgressHydrationToClient(
    client: Client,
    opts?: { readonly includeLobbyState?: boolean },
  ): void {
    if (this.lobbyPhase !== "IN_PROGRESS") return

    const pd = client.userData as PlayerData
    const economy = this.economies.get(pd.playerId)

    if (opts?.includeLobbyState) {
      client.send(RoomEvent.LobbyState, this.buildLobbyState())
    }
    if (economy) {
      client.send(RoomEvent.ShopState, buildShopStatePayload(economy))
    }
    if (this.simulation) {
      const gameStateSync = parseGameStateSyncPayload(
        this.simulation.buildGameStateSyncPayload(Date.now()),
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
    this.clearLobbyIdleTimer()
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
        { event: "room.client_ready.timeout", area: "netcode", side: "server", roomId: this.roomId, phase: this.lobbyPhase },
        "[GameLobbyRoom] client_scene_ready timeout — proceeding with available clients",
      )
      this.beginCountdown()
    }, resolveClientReadyTimeoutMs())

    logger.info(
      { event: "room.phase.waiting_for_clients", area: "netcode", side: "server", roomId: this.roomId, phase: this.lobbyPhase },
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
        area: "netcode",
        side: "server",
        roomId: this.roomId,
        phase: this.lobbyPhase,
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
      this.syncAbilitySlotsToSimulation(pd.playerId, economy)
      // Seed each client with its starting shop state so the shop modal shows
      // correct gold + default ability-0 assignment immediately on MatchGo,
      // without requiring a request_resync or a first purchase.
      client.send(RoomEvent.ShopState, buildShopStatePayload(economy))
    }

    const gameStateSync = parseGameStateSyncPayload(
      this.simulation.buildGameStateSyncPayload(Date.now()),
    )
    this.broadcast(RoomEvent.MatchGo, {})
    this.broadcast(RoomEvent.GameStateSync, gameStateSync)

    // Start the fixed-rate game loop (see TICK_MS; 60 Hz by default).
    activeGameLoopRoomIds.add(this.roomId)
    this.resetNetworkBatchingState(Date.now())
    this.resetPerformanceWindow(performance.now())
    this.gameLoopTimer = nativeSetInterval(() => {
      this.runGameTick()
    }, TICK_MS)

    logger.info(
      {
        event: "room.phase.in_progress",
        area: "netcode",
        side: "server",
        roomId: this.roomId,
        phase: this.lobbyPhase,
        players: this.clients.length,
      },
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
    this.gameLoopTimer?.clear()
    this.gameLoopTimer = null
    this.clearMatchRuntimeState()

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
      {
        event: "room.phase.scoreboard",
        area: "netcode",
        side: "server",
        roomId: this.roomId,
        phase: this.lobbyPhase,
        endReason,
        entries: entries.length,
      },
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
      { event: "room.phase.lobby", area: "netcode", side: "server", roomId: this.roomId, phase: this.lobbyPhase },
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
      { event: "room.host_transfer", area: "netcode", side: "server", roomId: this.roomId, newHostId, phase: this.lobbyPhase },
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
      { event: "room.dissolved", area: "netcode", side: "server", roomId: this.roomId, reason, phase: this.lobbyPhase },
      "[GameLobbyRoom] dissolved",
    )
  }

  async adminCloseLobby(input: AdminCloseLobbyInput): Promise<AdminCloseLobbyResult> {
    const playerCount = this.clients.length
    if (this.isAdminClosing && this.adminClosePayload) {
      return {
        status: "closing",
        occupied: true,
        closeAtServerMs: this.adminClosePayload.closeAtServerMs,
        countdownMs: this.adminClosePayload.countdownMs,
      }
    }

    if (playerCount > 0 && !input.confirmed) {
      logger.warn(
        {
          event: "room.admin_close.rejected",
          area: "admin",
          side: "server",
          roomId: this.roomId,
          adminUserId: input.adminUserId,
          phase: this.lobbyPhase,
          playerCount,
          reason: "confirmation_required",
        },
        "[GameLobbyRoom] admin close rejected",
      )
      return {
        status: "confirmation_required",
        occupied: true,
        playerCount,
        lobbyPhase: this.lobbyPhase,
      }
    }

    this.isAdminClosing = true
    await this.lock()
    this.stopForAdminClose()

    if (playerCount === 0) {
      void this.disconnect(CLOSE_CODE_ADMIN_CLOSED)
      logger.warn(
        {
          event: "room.admin_close.completed",
          area: "admin",
          side: "server",
          roomId: this.roomId,
          adminUserId: input.adminUserId,
          phase: this.lobbyPhase,
          playerCount,
          immediate: true,
        },
        "[GameLobbyRoom] admin closed empty lobby",
      )
      return { status: "closed", occupied: false, closeAtServerMs: null }
    }

    const countdownMs = resolveAdminCloseCountdownMs()
    const closeAtServerMs = Date.now() + countdownMs
    this.adminClosePayload = {
      reason: "admin_closed",
      closeAtServerMs,
      countdownMs,
      message: "This lobby or game session is being ended by an admin.",
    }
    this.broadcast(RoomEvent.LobbyAdminClosing, this.adminClosePayload)
    this.adminCloseTimer?.clear()
    this.adminCloseTimer = nativeSetTimeout(() => {
      this.adminCloseTimer = null
      void this.disconnect(CLOSE_CODE_ADMIN_CLOSED)
    }, countdownMs)

    logger.warn(
      {
        event: "room.admin_close.started",
        area: "admin",
        side: "server",
        roomId: this.roomId,
        adminUserId: input.adminUserId,
        adminUsername: input.adminUsername,
        phase: this.lobbyPhase,
        playerCount,
        closeAtServerMs,
        countdownMs,
      },
      "[GameLobbyRoom] admin close started",
    )

    return {
      status: "closing",
      occupied: true,
      closeAtServerMs,
      countdownMs,
    }
  }

  private stopForAdminClose(): void {
    this.clearLobbyIdleTimer()
    this.countdownTimer?.clear()
    this.countdownTimer = null
    this.clientReadyTimer?.clear()
    this.clientReadyTimer = null
    this.scoreboardTimer?.clear()
    this.scoreboardTimer = null
    this.disposalGraceTimer?.clear()
    this.disposalGraceTimer = null
    this.gameLoopTimer?.clear()
    this.gameLoopTimer = null
    this.clearMatchRuntimeState()
    this.clientReadySet.clear()
    this.returnedToLobbySet.clear()
  }

  private clearMatchRuntimeState(): void {
    this.clearInProgressPlayerCleanupTimers()
    this.simulation = null
    this.economies.clear()
    this.inputQueue.clear()
    this.highestAcceptedSeqByPlayer.clear()
    activeGameLoopRoomIds.delete(this.roomId)
    this.pendingPlayerDeltaBatches = []
    this.pendingFireballBatches = []
  }

  // ---------------------------------------------------------------------------
  // Game tick
  // ---------------------------------------------------------------------------

  /**
   * Resets low-rate network batching state at match start.
   *
   * @param nowMs - Current wall-clock time.
   */
  private resetNetworkBatchingState(nowMs: number): void {
    this.pendingPlayerDeltaBatches = []
    this.pendingFireballBatches = []
    this.playerBatchSeq = 0
    this.fireballBatchSeq = 0
    this.lastNetworkFlushAtMs = nowMs
  }

  /**
   * Resets the server performance aggregation window.
   *
   * @param nowPerfMs - Current performance-clock time.
   */
  private resetPerformanceWindow(nowPerfMs: number): void {
    this.performanceWindowStartedAtPerfMs = nowPerfMs
    this.performanceWindowCpuStart = process.cpuUsage()
    this.performanceDroppedDebtMs = 0
    this.performanceCatchUpCallbacks = 0
    this.performanceInputQueueDrops = 0
    this.performanceSimDurationMs = 0
    this.performanceBroadcastDurationMs = 0
    this.performanceEventLoopLagMs = 0
    this.expectedNextTickAtPerfMs = nowPerfMs + TICK_MS
  }

  /**
   * Records event-loop lateness for the current tick.
   *
   * @param nowPerfMs - Current performance-clock time.
   */
  private recordLoopTiming(nowPerfMs: number): void {
    if (this.expectedNextTickAtPerfMs <= 0) {
      this.expectedNextTickAtPerfMs = nowPerfMs + TICK_MS
      return
    }
    const lagMs = Math.max(0, nowPerfMs - this.expectedNextTickAtPerfMs)
    this.performanceEventLoopLagMs = Math.max(this.performanceEventLoopLagMs, lagMs)
    if (lagMs > TICK_MS) {
      this.performanceDroppedDebtMs += lagMs
      this.performanceCatchUpCallbacks += Math.floor(lagMs / TICK_MS)
    }
    this.expectedNextTickAtPerfMs = nowPerfMs + TICK_MS
  }

  /**
   * Returns whether cadence-limited visual batches should flush now.
   *
   * @param serverTimeMs - Current wall-clock time.
   * @returns True when pending visual deltas should be broadcast room-wide.
   */
  private shouldFlushVisualBatches(serverTimeMs: number): boolean {
    return (
      serverTimeMs - this.lastNetworkFlushAtMs >=
      this.performanceConfig.netSendIntervalMs
    )
  }

  /**
   * Sends owner-only ACK deltas so reconciliation is not delayed by visual cadence.
   *
   * @param playerDeltas - Player deltas from the current simulation tick.
   * @param serverTimeMs - Current server wall-clock time.
   */
  private sendOwnerAckDeltas(
    playerDeltas: readonly PlayerDelta[],
    serverTimeMs: number,
  ): void {
    const sim = this.simulation
    if (!sim) return
    for (const delta of playerDeltas) {
      if (
        delta.lastProcessedInputSeq === undefined ||
        delta.x === undefined ||
        delta.y === undefined
      ) {
        continue
      }
      const playerId = sim.entityPlayerMap.get(delta.id)
      if (!playerId) continue
      const client = this.findClientByUserId(playerId)
      if (!client) continue
      client.send(RoomEvent.PlayerBatchUpdate, {
        deltas: [
          {
            id: delta.id,
            x: delta.x,
            y: delta.y,
            lastProcessedInputSeq: delta.lastProcessedInputSeq,
          },
        ],
        removedIds: [],
        seq: this.playerBatchSeq++,
        serverTimeMs,
      })
    }
  }

  /**
   * Flushes pending room-wide visual movement/projectile batches.
   *
   * @param serverTimeMs - Current server wall-clock time.
   */
  private flushPendingVisualBatches(serverTimeMs: number): void {
    if (this.pendingPlayerDeltaBatches.length > 0) {
      const deltas = mergePlayerBatch(this.pendingPlayerDeltaBatches)
      this.pendingPlayerDeltaBatches = []
      if (deltas.length > 0) {
        this.broadcast(RoomEvent.PlayerBatchUpdate, {
          deltas,
          removedIds: [],
          seq: this.playerBatchSeq++,
          serverTimeMs,
        })
      }
    }

    if (this.pendingFireballBatches.length > 0) {
      const fireballs = mergeFireballBatch(this.pendingFireballBatches)
      this.pendingFireballBatches = []
      if (fireballs.deltas.length > 0 || fireballs.removedIds.length > 0) {
        this.broadcast(RoomEvent.FireballBatchUpdate, {
          ...fireballs,
          seq: this.fireballBatchSeq++,
        })
      }
    }
    this.lastNetworkFlushAtMs = serverTimeMs
  }

  /**
   * Broadcasts low-rate server performance status when state changes or remains degraded.
   *
   * @param serverTimeMs - Current server wall-clock time.
   */
  private maybeBroadcastServerPerformanceStatus(serverTimeMs: number): void {
    const nowPerfMs = performance.now()
    const windowMs = nowPerfMs - this.performanceWindowStartedAtPerfMs
    if (windowMs < PERFORMANCE_STATUS_WINDOW_MS) return

    const cpu = process.cpuUsage(this.performanceWindowCpuStart)
    const memory = process.memoryUsage()
    const metrics: ServerPerformanceStatusPayload["metrics"] = {
      windowMs,
      droppedDebtMs: this.performanceDroppedDebtMs,
      catchUpCallbacks: this.performanceCatchUpCallbacks,
      inputQueueDrops: this.performanceInputQueueDrops,
      simDurationMs: this.performanceSimDurationMs,
      broadcastDurationMs: this.performanceBroadcastDurationMs,
      eventLoopLagMs: this.performanceEventLoopLagMs,
      processCpuPercent: ((cpu.user + cpu.system) / 1000 / windowMs) * 100,
      heapUsedBytes: memory.heapUsed,
      rssBytes: memory.rss,
      activeRooms: activeGameLoopRoomIds.size,
      connectedClients: this.clients.length,
    }
    const classification = classifyServerPerformance(metrics)
    const key = serverPerformanceStatusKey(classification)
    const shouldBroadcast =
      key !== this.lastPerformanceStatusKey ||
      (classification.degraded &&
        serverTimeMs - this.lastPerformanceStatusBroadcastAtMs >=
          SERVER_PERFORMANCE_STATUS_MIN_INTERVAL_MS)

    if (shouldBroadcast) {
      const payload = parseServerPerformanceStatusPayload({
        serverTimeMs,
        degraded: classification.degraded,
        reasons: classification.reasons,
        metrics,
      })
      this.broadcast(RoomEvent.ServerPerformanceStatus, payload)
      this.lastPerformanceStatusKey = key
      this.lastPerformanceStatusBroadcastAtMs = serverTimeMs
    }

    this.resetPerformanceWindow(nowPerfMs)
  }

  /**
   * Runs one game simulation tick, broadcasts deltas and events to all clients.
   * Called at `TICK_MS` intervals during `IN_PROGRESS` phase.
   *
   * Per-player input queues are mutated in-place by `simulation.tick`, which
   * pops exactly one queued input per player per tick.
   */
  private runGameTick(): void {
    if (!this.simulation || this.lobbyPhase !== "IN_PROGRESS") {
      return
    }

    const tickStartedAtPerfMs = performance.now()
    this.recordLoopTiming(tickStartedAtPerfMs)
    const serverTimeMs = Date.now()
    const simStartedAtPerfMs = performance.now()
    const output = this.simulation.tick(this.inputQueue, serverTimeMs)
    this.performanceSimDurationMs += performance.now() - simStartedAtPerfMs

    const broadcastStartedAtPerfMs = performance.now()
    if (
      output.playerDeltas.length > 0 ||
      output.fireballDeltas.length > 0 ||
      output.fireballRemovedIds.length > 0
    ) {
      if (output.playerDeltas.length > 0) {
        this.pendingPlayerDeltaBatches.push([...output.playerDeltas])
      }
      if (output.fireballDeltas.length > 0 || output.fireballRemovedIds.length > 0) {
        this.pendingFireballBatches.push({
          deltas: output.fireballDeltas,
          removedIds: output.fireballRemovedIds,
        })
      }
      if (this.shouldFlushVisualBatches(serverTimeMs)) {
        this.flushPendingVisualBatches(serverTimeMs)
      } else {
        this.sendOwnerAckDeltas(output.playerDeltas, serverTimeMs)
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
    for (const swing of output.primaryMeleeAttacks) {
      this.broadcast(RoomEvent.PrimaryMeleeAttack, swing)
    }
    for (const telegraph of output.combatTelegraphStarts) {
      this.broadcast(RoomEvent.CombatTelegraphStart, telegraph)
    }
    for (const telegraph of output.combatTelegraphEnds) {
      this.broadcast(RoomEvent.CombatTelegraphEnd, telegraph)
    }
    for (const sfx of output.abilitySfxEvents) {
      this.broadcast(RoomEvent.AbilitySfx, sfx)
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
    this.performanceBroadcastDurationMs += performance.now() - broadcastStartedAtPerfMs
    this.maybeBroadcastServerPerformanceStatus(serverTimeMs)
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
  // ---------------------------------------------------------------------------

  /**
   * Clears the lobby idle timeout and client-visible idle deadline without
   * rescheduling (used when leaving `LOBBY` or disposing the room).
   */
  private clearLobbyIdleTimer(): void {
    this.inactivityTimer?.clear()
    this.inactivityTimer = null
    this.lobbyIdleDeadlineMs = null
  }

  /**
   * Resets the lobby idle timer when `lobbyPhase === "LOBBY"`: clears any prior
   * deadline, arms idle for `resolveLobbyIdleTimeoutMs()`, updates
   * `lobbyIdleDeadlineMs`, and broadcasts `LobbyState` so clients refresh
   * `lobbyIdleExpiresAtServerMs`. Outside `LOBBY`, only clears any stale timer.
   */
  private resetInactivityTimer(): void {
    this.clearLobbyIdleTimer()
    if (this.lobbyPhase !== "LOBBY") {
      return
    }
    const durationMs = resolveLobbyIdleTimeoutMs()
    this.lobbyIdleDeadlineMs = Date.now() + durationMs
    this.inactivityTimer = nativeSetTimeout(() => {
      if (this.lobbyPhase !== "LOBBY") {
        return
      }
      this.dissolveLobby("lobby_expired")
    }, durationMs)
    this.broadcast(RoomEvent.LobbyState, this.buildLobbyState())
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
      ...(this.lobbyPhase === "LOBBY" && this.lobbyIdleDeadlineMs !== null
        ? { lobbyIdleExpiresAtServerMs: this.lobbyIdleDeadlineMs }
        : {}),
    }
  }

  // ---------------------------------------------------------------------------
  // Public accessors (testing / admin)
  // ---------------------------------------------------------------------------

  /**
   * Builds the dashboard snapshot for admin-only room introspection.
   *
   * @returns Current room metrics, roster, and bandwidth counters.
   */
  getAdminSnapshot(): AdminLobbySnapshot {
    const now = Date.now()
    const connectedPlayers = new Map<string, PlayerData>()
    for (const client of this.clients) {
      const pd = client.userData as PlayerData | undefined
      if (!pd) continue
      connectedPlayers.set(pd.playerId, pd)
      if (!this.adminRoster.has(pd.playerId)) {
        this.markAdminPlayerConnected(pd)
      }
    }

    const orderedRoster = [...this.adminRoster.values()].sort((a, b) => {
      const aIndex = this.joinOrder.indexOf(a.playerId)
      const bIndex = this.joinOrder.indexOf(b.playerId)
      return (
        (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
        (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex)
      )
    })
    const playStatus = adminPlayStatusForPhase(this.lobbyPhase)
    const players = orderedRoster.map((entry): AdminLobbyPlayerSnapshot => {
      const connected = connectedPlayers.get(entry.playerId)
      const source = connected ?? entry
      return {
        playerId: source.playerId,
        username: source.username,
        heroId: source.heroId,
        isHost: source.playerId === this.hostPlayerId,
        isReady: source.isReady,
        clientSceneReady: source.clientSceneReady,
        connectionStatus: connected ? "connected" : entry.connectionStatus,
        playStatus,
        lastSeenAt: new Date(entry.lastSeenAtMs).toISOString(),
      }
    })
    const hostName =
      players.find((player) => player.playerId === this.hostPlayerId)?.username ?? ""

    return {
      snapshotAvailable: true,
      lobbyId: this.roomId,
      phase: this.lobbyPhase,
      createdAt: new Date(this.adminCreatedAtMs).toISOString(),
      uptimeMs: Math.max(0, now - this.adminCreatedAtMs),
      connectedPlayerCount: this.clients.length,
      rosterPlayerCount: this.adminRoster.size,
      maxPlayers: MAX_PLAYERS_PER_MATCH,
      hostPlayerId: this.hostPlayerId,
      hostName,
      bandwidth: {
        inboundBytes: this.adminInboundBytes,
        outboundBytes: this.adminOutboundBytes,
        totalBytes: this.adminInboundBytes + this.adminOutboundBytes,
      },
      players,
    }
  }

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
