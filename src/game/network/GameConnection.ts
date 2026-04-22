import { Client, Room } from "@colyseus/sdk"

import { getColyseusUrl } from "@/lib/endpoints"
import { RoomEvent, roomToWsEvent } from "@/shared/roomEvents"
import type {
  PlayerInputPayload,
  ClientSceneReadyPayload,
  AnyWsMessage,
  MessageHandler,
} from "@/shared/types"

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
  private _ready = false
  private _seq = 0
  private readonly token: string
  private readonly messageHandlers = new Set<MessageHandler>()
  private readonly readyHandlers = new Set<() => void>()

  constructor(args?: GameConnectionArgs) {
    this.client = new Client(args?.serverUrl ?? getColyseusUrl())
    this.token = args?.token ?? ""
  }

  /** Whether the connection has received its first state sync. */
  get ready(): boolean {
    return this._ready
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

    this._room = await this.client.joinById(roomId, { token: this.token })
    this.wireRoomListeners()
  }

  /**
   * Joins the game lobby room using options from sessionStorage.
   * Intended for Phaser scene boot where options are persisted by the React host.
   */
  async connect(): Promise<void> {
    if (this._room) return

    const raw = sessionStorage.getItem("ww_join_options")
    if (!raw) throw new Error("GameConnection: no join options found in sessionStorage")

    try {
      const { token, lobbyId } = JSON.parse(raw) as { token: string; lobbyId: string }
      this._room = await this.client.joinById(lobbyId, { token })
      this.wireRoomListeners()
    } catch {
      throw new Error("GameConnection: failed to parse join options from sessionStorage")
    }
  }

  /**
   * Leaves the current room and resets state.
   */
  async close(): Promise<void> {
    if (this._room) {
      await this._room.leave()
      this._room = null
    }
    this._ready = false
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
    this._room?.send(RoomEvent.LobbyChat, { text })
  }

  sendLobbyHeroSelect(heroId: string): void {
    this._room?.send(RoomEvent.LobbyHeroSelect, { heroId })
  }

  sendLobbyStartGame(): void {
    this._room?.send(RoomEvent.LobbyStartGame, {})
  }

  sendLobbyEndGame(): void {
    this._room?.send(RoomEvent.LobbyEndGame, {})
  }

  sendLobbyEndLobby(): void {
    this._room?.send(RoomEvent.LobbyEndLobby, {})
  }

  sendLobbyReturnToLobby(): void {
    this._room?.send(RoomEvent.LobbyReturnToLobby, {})
  }

  sendRequestResync(): void {
    this._room?.send(RoomEvent.RequestResync, {})
  }

  // ─── Send Helpers (Game) ───────────────────────────────────────────────────

  sendClientSceneReady(): void {
    const payload: ClientSceneReadyPayload = {}
    this._room?.send(RoomEvent.ClientSceneReady, payload)
  }

  sendPlayerInput(input: PlayerInputPayload): void {
    this._room?.send(RoomEvent.PlayerInput, input)
  }

  /** Returns and increments the local sequence counter for PlayerInput. */
  nextSeq(): number {
    return this._seq++
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private wireRoomListeners(): void {
    if (!this._room) return

    // Wildcard listener for all room messages
    this._room.onMessage("*", (type: string | number, payload: unknown) => {
      const roomKey = String(type)
      const wsKey = roomToWsEvent[roomKey]
      if (!wsKey) return

      // Mark ready on first lobby state or game sync
      if (!this._ready && (roomKey === RoomEvent.LobbyState || roomKey === RoomEvent.GameStateSync)) {
        this._ready = true
        this.readyHandlers.forEach((h) => h())
      }

      const message: AnyWsMessage = { type: wsKey, payload }
      this.messageHandlers.forEach((handler) => handler(message))
    })

    this._room.onLeave(async (code) => {
      if (code === 1000) {
        this._room = null
        this._ready = false
        return
      }

      // Reconnect logic for unexpected drops
      try {
        if (this._room) {
          this._room = await this.client.reconnect(this._room.reconnectionToken, RECONNECT_WINDOW_MS)
          this.wireRoomListeners()
        }
      } catch {
        this._room = null
        this._ready = false
      }
    })

    this._room.onError(() => {
      this._ready = false
    })
  }
}
