import { Client, Room } from "@colyseus/sdk"

import { getColyseusUrl } from "@/lib/endpoints"
import { clientLogger } from "@/lib/clientLogger"
import { RoomEvent, roomToWsEvent } from "@/shared/roomEvents"
import type {
  PlayerInputPayload,
  ClientSceneReadyPayload,
  AnyWsMessage,
  MessageHandler,
  LobbyPhase,
  LobbyStatePayload,
} from "@/shared/types"
import { summarizePayload } from "@/shared/logging/sanitize"

/** Reconnect window in ms. Colyseus will attempt reconnect within this window. */
const RECONNECT_WINDOW_MS = 60_000

/**
 * Options accepted when joining a Colyseus room.
 */
export interface GameConnectionArgs {
  readonly serverUrl: string
  readonly token: string
}

/**
 * Adapter for Colyseus SDK that normalizes message dispatch and provides a
 * typed API for lobby and game events.
 *
 * Translates RoomEvent snake_case keys to WsEvent SCREAMING_SNAKE keys via
 * `roomToWsEvent` map and wraps payloads into `{ type, payload }` AnyWsMessage
 * objects for subscribers.
 */
export class GameConnection {
  private client: Client
  private _room: Room | null = null
  /** Remover returned by Colyseus for the `"*"` wildcard handler; cleared when rewiring. */
  private _wildcardMessageOff?: () => void
  private _ready = false
  private _seq = 0
  /** Latest `LobbyState.phase` from the server; updated before message fan-out. */
  private _lobbyPhase: LobbyPhase | null = null
  private readonly token: string
  private readonly messageHandlers = new Set<MessageHandler>()
  private readonly readyHandlers = new Set<() => void>()
  private readonly log = clientLogger.child({ area: "netcode" })

  constructor(args?: GameConnectionArgs) {
    this.client = new Client(args?.serverUrl ?? getColyseusUrl())
    this.token = args?.token ?? ""
  }

  /** Whether the connection has received its first state sync. */
  get ready(): boolean {
    return this._ready
  }

  /**
   * Last observed lobby FSM phase from `LobbyState`, or null before the first
   * payload.
   */
  get lobbyPhase(): LobbyPhase | null {
    return this._lobbyPhase
  }

  /**
   * @returns True when the server reports an active match (`IN_PROGRESS`).
   */
  isMatchInProgress(): boolean {
    return this._lobbyPhase === "IN_PROGRESS"
  }

  /**
   * Registers a callback to be fired when the connection becomes ready.
   * If already ready, the callback is fired immediately.
   *
   * @param handler - Function to call on ready.
   * @returns Unsubscribe function.
   */
  onReady(handler: () => void): () => void {
    if (this._ready) handler()
    this.readyHandlers.add(handler)
    return () => {
      this.readyHandlers.delete(handler)
    }
  }

  /** The active Colyseus Room instance, or null before connect(). */
  get room(): Room | null {
    return this._room
  }

  /**
   * Joins a room by its ID.
   *
   * @param roomId - Colyseus room id to join.
   */
  async connectById(roomId: string): Promise<void> {
    if (this._room) return

    this.log.info({ event: "net.connect.start", roomId }, "Joining game room by id")
    try {
      this._room = await this.client.joinById(roomId, { token: this.token })
      this.log.info(
        { event: "net.connect.success", roomId, sessionId: this._room.sessionId },
        "Joined game room",
      )
      this.wireRoomListeners()
    } catch (err) {
      this.log.error({ event: "net.connect.failed", roomId, err }, "Failed to join game room")
      throw err
    }
  }

  /**
   * Joins the game lobby room using options from sessionStorage.
   * Intended for Phaser scene boot where options are persisted by the React host.
   */
  async connect(): Promise<void> {
    if (this._room) return

    const raw = sessionStorage.getItem("ww_join_options")
    if (!raw) {
      this.log.error(
        { event: "net.connect.failed", reason: "missing_join_options" },
        "No join options found in sessionStorage",
      )
      throw new Error("GameConnection: no join options found in sessionStorage")
    }

    try {
      const { token, lobbyId } = JSON.parse(raw) as { token: string; lobbyId: string }
      this.log.info({ event: "net.connect.start", roomId: lobbyId }, "Joining game room from sessionStorage")
      this._room = await this.client.joinById(lobbyId, { token })
      this.log.info(
        { event: "net.connect.success", roomId: lobbyId, sessionId: this._room.sessionId },
        "Joined game room",
      )
      this.wireRoomListeners()
    } catch (err) {
      this.log.error({ event: "net.connect.failed", err }, "Failed to parse or use join options")
      throw new Error("GameConnection: failed to parse join options from sessionStorage")
    }
  }

  /**
   * Leaves the current room and resets state.
   */
  async close(): Promise<void> {
    if (this._room) {
      this.log.info(
        { event: "net.connection.close", roomId: this._room.roomId, sessionId: this._room.sessionId },
        "Leaving game room",
      )
      await this._room.leave()
      this._room = null
    }
    this._ready = false
    this._lobbyPhase = null
    this.messageHandlers.clear()
    this.readyHandlers.clear()
  }

  /**
   * Registers a callback for all inbound messages.
   *
   * @param handler - Message handler function.
   * @returns Unsubscribe function.
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => {
      this.messageHandlers.delete(handler)
    }
  }

  /** Whether the socket is currently connected. */
  isConnected(): boolean {
    return this._room !== null
  }

  /** Access to the underlying Colyseus session ID. */
  get sessionId(): string | undefined {
    return this._room?.sessionId
  }

  // ─── Send Helpers (Lobby) ──────────────────────────────────────────────────

  sendLobbyChat(text: string): void {
    this.send(RoomEvent.LobbyChat, { text })
  }

  sendLobbyHeroSelect(heroId: string): void {
    this.send(RoomEvent.LobbyHeroSelect, { heroId })
  }

  sendLobbyStartGame(): void {
    this.send(RoomEvent.LobbyStartGame, {})
  }

  sendLobbyEndGame(): void {
    this.send(RoomEvent.LobbyEndGame, {})
  }

  sendLobbyEndLobby(): void {
    this.send(RoomEvent.LobbyEndLobby, {})
  }

  sendLobbyReturnToLobby(): void {
    this.send(RoomEvent.LobbyReturnToLobby, {})
  }

  sendRequestResync(): void {
    this.send(RoomEvent.RequestResync, {})
  }

  // ─── Send Helpers (Game) ───────────────────────────────────────────────────

  sendClientSceneReady(): void {
    const payload: ClientSceneReadyPayload = {}
    this.send(RoomEvent.ClientSceneReady, payload)
  }

  sendPlayerInput(input: PlayerInputPayload): void {
    this.send(RoomEvent.PlayerInput, input, { sampleEvery: 60, seq: input.seq })
  }

  // ─── Send Helpers (Shop / Inventory) ──────────────────────────────────────

  /**
   * Purchase a shop item. Server validates gold, stackability, slot rules.
   *
   * @param itemId - The `SHOP_ITEMS` id to buy.
   */
  sendShopPurchase(itemId: string): void {
    this.send(RoomEvent.ShopPurchase, { itemId })
  }

  /**
   * Assign an owned ability to a slot (0-4) on the ability bar.
   *
   * @param itemId - The ability id to assign.
   * @param slotIndex - Slot index in range 0..ABILITY_BAR_SLOT_COUNT-1.
   */
  sendAssignAbility(itemId: string, slotIndex: number): void {
    this.send(RoomEvent.AssignAbility, { itemId, slotIndex })
  }

  /**
   * Consume a charge from a quick-item slot (Q/6/7/8 → slotIndex 0..3).
   *
   * @param slotIndex - Quick item slot index.
   */
  sendUseQuickItem(slotIndex: number): void {
    this.send(RoomEvent.UseQuickItem, { slotIndex })
  }

  /** Returns and increments the local sequence counter for PlayerInput. */
  nextSeq(): number {
    return this._seq++
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Wires Colyseus room events. Reconnect calls this again; the previous `"*"`
   * handler is removed first so message fan-out is not duplicated.
   */
  private wireRoomListeners(): void {
    if (!this._room) return

    this._wildcardMessageOff?.()
    this._wildcardMessageOff = undefined

    // Wildcard listener for all room messages
    const off = this._room.onMessage("*", (type: string | number, payload: unknown) => {
      const roomKey = String(type)
      const wsKey = roomToWsEvent[roomKey]
      if (!wsKey) {
        this.log.warn(
          {
            event: "net.message.unknown",
            roomId: this._room?.roomId,
            sessionId: this._room?.sessionId,
            reason: "unmapped_room_event",
            roomEvent: roomKey,
            payload: summarizePayload(payload),
          },
          "Received unmapped room event",
        )
        return
      }

      // Mark ready on first lobby state or game sync
      if (!this._ready && (roomKey === RoomEvent.LobbyState || roomKey === RoomEvent.GameStateSync)) {
        this._ready = true
        this.log.info(
          {
            event: "net.connection.ready",
            roomId: this._room?.roomId,
            sessionId: this._room?.sessionId,
            reason: roomKey,
          },
          "Game connection became ready",
        )
        this.readyHandlers.forEach((h) => h())
      }

      if (roomKey === RoomEvent.LobbyState && payload && typeof payload === "object") {
        this._lobbyPhase = (payload as LobbyStatePayload).phase
      }

      const message: AnyWsMessage = { type: wsKey, payload }
      this.messageHandlers.forEach((handler) => handler(message))
    })
    this._wildcardMessageOff = typeof off === "function" ? off : undefined

    this._room.onLeave(async (code) => {
      if (code === 1000) {
        this.log.info(
          { event: "net.connection.closed", roomId: this._room?.roomId, sessionId: this._room?.sessionId, code },
          "Game room left cleanly",
        )
        this._room = null
        this._ready = false
        this._lobbyPhase = null
        return
      }

      // Reconnect logic for unexpected drops
      try {
        if (this._room) {
          const previousRoomId = this._room.roomId
          const previousSessionId = this._room.sessionId
          this.log.warn(
            { event: "net.reconnect.start", roomId: previousRoomId, sessionId: previousSessionId, code },
            "Unexpected room leave; attempting reconnect",
          )
          this._room = await this.client.reconnect(this._room.reconnectionToken, RECONNECT_WINDOW_MS)
          this.log.info(
            { event: "net.reconnect.success", roomId: this._room.roomId, sessionId: this._room.sessionId },
            "Reconnected to game room",
          )
          this.wireRoomListeners()
        }
      } catch (err) {
        this.log.warn({ event: "net.reconnect.failed", err, code }, "Reconnect failed")
        this._room = null
        this._ready = false
        this._lobbyPhase = null
      }
    })

    this._room.onError((code, message) => {
      this.log.error(
        { event: "net.connection.error", roomId: this._room?.roomId, sessionId: this._room?.sessionId, code, message },
        "Game room connection error",
      )
      this._ready = false
      this._lobbyPhase = null
    })
  }

  private send(
    type: RoomEvent,
    payload: unknown,
    opts: { readonly sampleEvery?: number; readonly seq?: number } = {},
  ): void {
    if (!this._room) {
      this.log.debug(
        { event: "net.send.skipped", reason: "not_connected", roomEvent: type, seq: opts.seq },
        "Skipped send because no room is connected",
      )
      return
    }

    const shouldTrace = opts.sampleEvery === undefined || opts.seq === undefined || opts.seq % opts.sampleEvery === 0
    if (shouldTrace) {
      this.log.trace(
        {
          event: "net.send",
          roomId: this._room.roomId,
          sessionId: this._room.sessionId,
          roomEvent: type,
          seq: opts.seq,
          payload: summarizePayload(payload),
        },
        "Sending room event",
      )
    }
    this._room.send(type, payload)
  }
}
