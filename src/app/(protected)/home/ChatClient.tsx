"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Client, type Room } from "@colyseus/sdk"

import { fetchWsAuthToken } from "@/lib/fetch-ws-auth-token"
import { getColyseusUrl } from "@/lib/endpoints"
import { RoomEvent } from "@/shared/roomEvents"
import type { ChatMessage, ChatPresenceUser } from "@/shared/types"
import {
  LobbyHeader,
  LobbyPanel,
  LobbyShell,
  LobbyStatusPill,
} from "@/components/lobby/LobbyChrome"
import {
  btnPrimary,
  cardInset,
  chatViewport,
  gridChatSpan,
  inputChat,
  lobbyMainGrid,
  lobbySidebarStack,
  messageName,
  messageBody,
  messageSep,
  errorBanner,
  metaText,
  onlineLabelClass,
} from "@/lib/ui/lobbyStyles"

const MAX_CHARS = 200

/**
 * Fetches the latest chat log via tRPC.
 *
 * @returns Array of ChatMessage objects from the server.
 */
async function fetchChatHistory(): Promise<ChatMessage[]> {
  try {
    const res = await fetch("/api/trpc/chat.latest", { credentials: "include" })
    if (!res.ok) return []
    const json = (await res.json()) as { result?: { data?: { json?: { messages?: ChatMessage[] } } } }
    return json.result?.data?.json?.messages ?? []
  } catch {
    return []
  }
}

/**
 * Global chat client component.
 * Connects to the Colyseus `chat` room, shows message history,
 * live updates, and presence list.
 */
export default function ChatClient() {
  const router = useRouter()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [presence, setPresence] = useState<ChatPresenceUser[]>([])
  const [inputText, setInputText] = useState("")
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const roomRef = useRef<Room | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** Scrolls the message list to the bottom. */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  // Load history and connect to Colyseus chat room
  useEffect(() => {
    let cancelled = false

    async function connect() {
      const history = await fetchChatHistory()
      if (cancelled) return
      setMessages(history)

      const token = await fetchWsAuthToken()
      if (!token) {
        setError("Not authenticated")
        return
      }

      try {
        const client = new Client(getColyseusUrl())
        const room = await client.joinOrCreate<unknown>("chat", { token })
        if (cancelled) {
          room.leave()
          return
        }

        roomRef.current = room
        setConnected(true)

        /** Handle a new inbound chat message. */
        room.onMessage(RoomEvent.ChatMessage, (msg: ChatMessage) => {
          setMessages((prev) => [...prev, msg])
        })

        /** Handle full presence list refresh. */
        room.onMessage(RoomEvent.ChatPresence, (payload: { users: ChatPresenceUser[] }) => {
          setPresence(payload.users)
        })

        room.onLeave(() => {
          if (!cancelled) setConnected(false)
        })

        room.onError((_code, message) => {
          if (!cancelled) setError(message ?? "Room error")
        })
      } catch {
        if (!cancelled) setError("Could not connect to chat")
      }
    }

    void connect()

    return () => {
      cancelled = true
      roomRef.current?.leave()
      roomRef.current = null
    }
  }, [])

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  /**
   * Sends the current input text as a chat message.
   * No-ops if the room is not connected or input is empty/too long.
   */
  const sendMessage = useCallback(() => {
    const text = inputText.trim()
    if (!text || !roomRef.current || text.length > MAX_CHARS) return
    roomRef.current.send(RoomEvent.ChatMessage, { text })
    setInputText("")
  }, [inputText])

  /**
   * Handles keyboard events on the chat input.
   * Enter sends the message; Escape blurs the input.
   *
   * @param e - The keyboard event.
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        sendMessage()
      } else if (e.key === "Escape") {
        inputRef.current?.blur()
      }
    },
    [sendMessage],
  )

  /**
   * Navigates to the browse games page.
   */
  const onBrowseGames = useCallback(() => {
    router.push("/browse")
  }, [router])

  return (
    <LobbyShell>
      <LobbyHeader
        eyebrow="Wizard Wars"
        title="Global Lobby"
        subtitle="Meet other wizards, keep an eye on who is online, and jump into an open room when you are ready to play."
        aside={
          <>
            <LobbyStatusPill tone={connected ? "success" : "warning"}>
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-300" : "bg-amber-300"}`} />
              {connected ? "Chat Connected" : "Connecting"}
            </LobbyStatusPill>
            <button className={btnPrimary} onClick={onBrowseGames} type="button">
              Browse Games
            </button>
          </>
        }
      />

      <div className={lobbyMainGrid}>
        <div className={lobbySidebarStack}>
          <LobbyPanel
            eyebrow="Presence"
            title={`Online Wizards (${presence.length})`}
            subtitle="Everyone currently waiting in the global lobby."
          >
            {presence.length === 0 ? (
              <div className={cardInset}>
                <p className="text-sm italic text-slate-400">No one else online right now.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {presence.map((u) => (
                  <li
                    key={u.userId}
                    className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/3 px-4 py-3 text-sm text-slate-200"
                  >
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    <span className="font-medium text-white">{u.username}</span>
                  </li>
                ))}
              </ul>
            )}
          </LobbyPanel>

          <LobbyPanel eyebrow="Status" title="Lobby Connection" tone="solid">
            <div className={cardInset}>
              <p className={metaText}>Realtime Status</p>
              <div className="mt-3 flex items-center gap-3">
                <span
                  className={`h-3 w-3 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`}
                />
                <div>
                  <p className="text-sm font-semibold text-white">
                    {connected ? "Connected to global chat" : "Establishing connection"}
                  </p>
                  <p className={onlineLabelClass}>
                    {connected
                      ? "Messages and presence updates are live."
                      : "Realtime chat will unlock as soon as the room connects."}
                  </p>
                </div>
              </div>
            </div>
            <button
              className="mt-4 w-full rounded-2xl border border-white/12 bg-white/4 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/8"
              onClick={onBrowseGames}
              type="button"
            >
              View Open Lobbies
            </button>
          </LobbyPanel>
        </div>

        <LobbyPanel
          eyebrow="Public Channel"
          title="Global Chat"
          subtitle="Talk strategy, find players, and coordinate your next match."
          className={gridChatSpan}
          contentClassName="flex h-full flex-col"
          aside={<LobbyStatusPill tone="accent">{messages.length} messages</LobbyStatusPill>}
        >
          {error && <div className={`mb-4 ${errorBanner}`}>{error}</div>}

          <div className={`${chatViewport} mb-4 flex-1 overflow-y-auto`} style={{ maxHeight: "360px" }}>
            {messages.length === 0 && !error && (
              <p className="text-sm italic text-slate-400">No messages yet. Start the conversation.</p>
            )}
            <ul className="space-y-3">
              {messages.map((msg) => (
                <li
                  key={msg.id}
                  className="rounded-2xl border border-white/6 bg-white/3 px-4 py-3 text-sm leading-relaxed"
                >
                  <span className={messageName}>{msg.username}</span>
                  <span className={messageSep}>: </span>
                  <span className={messageBody}>{msg.text}</span>
                </li>
              ))}
            </ul>
            <div ref={messagesEndRef} />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              ref={inputRef}
              className={inputChat}
              type="text"
              placeholder="Type a message... (Enter to send, Esc to blur)"
              maxLength={MAX_CHARS}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!connected}
            />
            <button
              className={btnPrimary}
              onClick={sendMessage}
              disabled={!connected || !inputText.trim()}
              type="button"
            >
              Send
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <span>{connected ? "Press Enter to send instantly." : "Waiting for chat connection."}</span>
            {inputText.length > MAX_CHARS * 0.85 ? (
              <span>
                {inputText.length}/{MAX_CHARS}
              </span>
            ) : null}
          </div>
        </LobbyPanel>
      </div>
    </LobbyShell>
  )
}
