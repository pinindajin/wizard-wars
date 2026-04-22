import { Client, Room } from "@colyseus/sdk"

import { getColyseusUrl } from "@/lib/endpoints"
import { RoomEvent } from "@/shared/roomEvents"
import type { PlayerInputPayload, ClientSceneReadyPayload } from "@/shared/types"

/** Reconnect window in ms. Colyseus will attempt reconnect within this window. */
const RECONNECT_WINDOW_MS = 60_000

/** Options accepted when joining the lobby room. */
export interface JoinOptions {
  /** JWT auth token from the session. */
  token: string
  /** Lobby room id to join. */
  lobbyId: string
}

/**
 * Wraps the Colyseus SDK Client for the wizard-wars game room.
 * Handles join, reconnect, scene-ready handshake, and input sending.
 */
export class GameConnection {
  private client: Client
  private _room: Room | null = null
  private _seq = 0
  private joinOptions: JoinOptions | null = null

  constructor() {
    this.client = new Client(getColyseusUrl())
  }

  /** The active Colyseus Room instance, or null before connect(). */
  get room(): Room | null {
    return this._room
  }

  /**
   * Joins the game lobby room with the provided options.
   * Falls back to reading a stored wwToken from sessionStorage if no options provided.
   *
   * @param options - Optional join options; reads from sessionStorage if omitted.
   * @returns The joined Room instance.
   */
  async connect(options?: JoinOptions): Promise<Room> {
    const opts = options ?? this._readStoredOptions()
    if (!opts) throw new Error("GameConnection: no join options and none found in sessionStorage")

    this.joinOptions = opts
    this._room = await this.client.joinById(opts.lobbyId, { token: opts.token })
    this._attachReconnectHandler()
    return this._room
  }

  /**
   * Sends the ClientSceneReady signal to the server to unlock the match countdown.
   */
  sendClientSceneReady(): void {
    const payload: ClientSceneReadyPayload = {}
    this._room?.send(RoomEvent.ClientSceneReady, payload)
  }

  /**
   * Sends a PlayerInput message to the server for the current tick.
   *
   * @param input - The full input payload for this tick.
   */
  sendPlayerInput(input: PlayerInputPayload): void {
    this._room?.send(RoomEvent.PlayerInput, input)
  }

  /**
   * Returns and increments the local sequence counter for outbound PlayerInput messages.
   *
   * @returns The next sequence number.
   */
  nextSeq(): number {
    return this._seq++
  }

  /**
   * Gracefully leaves the room and cleans up.
   */
  async disconnect(): Promise<void> {
    if (this._room) {
      await this._room.leave()
      this._room = null
    }
  }

  /**
   * Wires the room's onLeave handler to attempt automatic reconnect within the window.
   */
  private _attachReconnectHandler(): void {
    if (!this._room) return

    this._room.onLeave(async (code) => {
      if (code === 1000) return // clean leave
      if (!this.joinOptions) return

      console.warn(`[GameConnection] disconnected (code=${code}), attempting reconnect…`)
      try {
        this._room = await this.client.reconnect(
          this._room!.reconnectionToken,
          RECONNECT_WINDOW_MS,
        )
        this._attachReconnectHandler()
        console.info("[GameConnection] reconnected successfully")
      } catch (err) {
        console.error("[GameConnection] reconnect failed", err)
      }
    })
  }

  /**
   * Reads join options from sessionStorage (set by the lobby page before launching the scene).
   *
   * @returns Parsed JoinOptions or null if not found.
   */
  private _readStoredOptions(): JoinOptions | null {
    if (typeof window === "undefined") return null
    const raw = sessionStorage.getItem("ww_join_options")
    if (!raw) return null
    try {
      return JSON.parse(raw) as JoinOptions
    } catch {
      return null
    }
  }
}
