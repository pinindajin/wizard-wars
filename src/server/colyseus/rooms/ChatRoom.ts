import { Room, type Client } from "colyseus"
import { randomUUID } from "node:crypto"

import { verifyToken } from "../../auth"
import type { ChatStore } from "../../store/types"
import { RoomEvent } from "../../../shared/roomEvents"
import type { AuthUser, ChatMessage, ChatPresencePayload, ChatPresenceUser } from "../../../shared/types"
import { CHAT_HISTORY_MAX_MESSAGES } from "../../../shared/constants"
import { logger } from "../../logger"

export type ChatRoomOptions = {
  readonly token?: string
}

/**
 * Global home-page chat Colyseus room: JWT onAuth, in-memory message buffer,
 * optional ChatStore for Postgres flush on a timer.
 * Retains up to CHAT_HISTORY_MAX_MESSAGES (100) messages; shows 50 on join.
 * Rate limit: 3 messages / 5s per client. Max message length: 200 chars.
 */
export class ChatRoom extends Room {
  autoDispose = false
  patchRate: number | null = null

  private bufferedMessages: ChatMessage[] = []
  private flushTimer: { clear: () => void } | null = null
  private chatStore: ChatStore | null = null

  /** Per-client rate-limit tracking: { count, windowStart }. */
  private readonly rateLimitMap = new Map<string, { count: number; windowStartMs: number }>()

  static readonly flushIntervalMs = 5 * 60 * 1000
  static readonly maxMessageLength = 200
  static readonly rateLimitCount = 3
  static readonly rateLimitWindowMs = 5000
  static readonly historyMaxRetained = 100
  static readonly historyShownOnJoin = 50

  /**
   * Injects the Postgres chat store for flushing buffered messages to DB.
   *
   * @param store - ChatStore implementation to use for persistence.
   */
  setChatStore(store: ChatStore): void {
    this.chatStore = store
  }

  /**
   * Verifies the JWT token from join options.
   *
   * @param _client - Connecting Colyseus client.
   * @param options - Join options containing the JWT token.
   * @returns Verified AuthUser extracted from the token.
   * @throws If the token is missing or invalid.
   */
  async onAuth(_client: Client, options: ChatRoomOptions): Promise<AuthUser> {
    const token = options?.token
    if (!token) {
      throw new Error("missing token")
    }
    return verifyToken(token)
  }

  /**
   * Starts the periodic chat flush timer on room creation.
   */
  onCreate(): void {
    this.flushTimer = this.clock.setInterval(() => {
      void this.flushMessages()
    }, ChatRoom.flushIntervalMs)
  }

  /**
   * Replays buffered chat history to the newly joined client and broadcasts presence.
   *
   * @param client - The newly connected Colyseus client.
   * @param _options - Join options (token already consumed by onAuth).
   * @param auth - The verified AuthUser from onAuth.
   */
  onJoin(client: Client, _options: ChatRoomOptions, auth: AuthUser): void {
    client.userData = { playerId: auth.sub, username: auth.username }

    const replayStart = Math.max(0, this.bufferedMessages.length - ChatRoom.historyShownOnJoin)
    for (let i = replayStart; i < this.bufferedMessages.length; i++) {
      client.send(RoomEvent.ChatMessage, this.bufferedMessages[i])
    }

    this.broadcast(RoomEvent.ChatPresence, this.buildPresencePayload())
    logger.debug({ event: "chat.join", userId: auth.sub, username: auth.username }, "User joined chat")
  }

  /**
   * Broadcasts updated presence list when a client disconnects.
   *
   * @param client - The disconnecting Colyseus client.
   */
  onLeave(client: Client): void {
    this.rateLimitMap.delete(client.sessionId)
    this.broadcast(RoomEvent.ChatPresence, this.buildPresencePayload({ excludeSessionId: client.sessionId }))
  }

  /**
   * Clears the flush timer and performs a final flush to DB on room disposal.
   */
  async onDispose(): Promise<void> {
    if (this.flushTimer) {
      this.flushTimer.clear()
    }
    await this.flushMessages()
  }

  /** Colyseus message handlers: one entry per wire event type. */
  messages = {
    chat_message: (client: Client, payload: { text?: string }) => {
      const text = payload?.text?.trim()
      if (!text || text.length > ChatRoom.maxMessageLength) {
        return
      }

      if (!this.checkRateLimit(client.sessionId)) {
        return
      }

      const userData = client.userData as { playerId: string; username: string }

      const message: ChatMessage = {
        id: randomUUID(),
        userId: userData.playerId,
        username: userData.username,
        text,
        createdAt: new Date().toISOString(),
      }

      this.bufferedMessages.push(message)
      if (this.bufferedMessages.length > ChatRoom.historyMaxRetained) {
        this.bufferedMessages.splice(0, this.bufferedMessages.length - ChatRoom.historyMaxRetained)
      }

      this.broadcast(RoomEvent.ChatMessage, message)
    },
  }

  /**
   * Checks and updates the per-client rate limit bucket (3 messages / 5s).
   *
   * @param sessionId - The Colyseus session ID of the sending client.
   * @returns `true` if the message is within the rate limit; `false` if throttled.
   */
  private checkRateLimit(sessionId: string): boolean {
    const now = Date.now()
    const entry = this.rateLimitMap.get(sessionId)

    if (!entry || now - entry.windowStartMs > ChatRoom.rateLimitWindowMs) {
      this.rateLimitMap.set(sessionId, { count: 1, windowStartMs: now })
      return true
    }

    if (entry.count >= ChatRoom.rateLimitCount) {
      return false
    }

    entry.count++
    return true
  }

  /**
   * Builds the chat presence payload from currently connected clients.
   *
   * @param opts - Optional excludeSessionId to skip a departing client.
   * @returns ChatPresencePayload with the current user list.
   */
  private buildPresencePayload(opts?: { excludeSessionId?: string }): ChatPresencePayload {
    const users: ChatPresenceUser[] = []
    for (const c of this.clients) {
      if (opts?.excludeSessionId !== undefined && c.sessionId === opts.excludeSessionId) {
        continue
      }
      const ud = c.userData as { playerId?: string; username?: string } | null | undefined
      if (!ud?.playerId || !ud.username) {
        continue
      }
      users.push({ userId: ud.playerId, username: ud.username })
    }
    return { users }
  }

  /**
   * Persists the buffered chat messages to Postgres and clears the buffer on success.
   * No-ops if no chatStore is configured or the buffer is empty.
   */
  private async flushMessages(): Promise<void> {
    if (!this.chatStore || this.bufferedMessages.length === 0) {
      return
    }
    const snapshot = this.bufferedMessages.slice()
    try {
      await this.chatStore.saveChatLog(snapshot)
      await this.chatStore.deleteOldLogs()
      this.bufferedMessages.length = 0
    } catch (err) {
      logger.error({ err, event: "chat.flush.error" }, "Failed to flush chat messages to DB")
    }
  }
}
