"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Client, type Room } from "@colyseus/sdk"

import { fetchWsAuthToken } from "@/lib/fetch-ws-auth-token"
import { getColyseusUrl } from "@/lib/endpoints"
import { RoomEvent } from "@/shared/roomEvents"
import type { ChatMessage, ChatPresenceUser } from "@/shared/types"

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
    <div className="flex min-h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-gray-700 bg-gray-800 p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-purple-400">⚔ Wizard Wars</h1>
          <p className="mt-1 text-xs text-gray-500">Global Lobby</p>
        </div>

        <button
          className="mb-3 w-full rounded-md bg-purple-600 py-2 text-sm font-semibold hover:bg-purple-700 active:bg-purple-800"
          onClick={onBrowseGames}
          type="button"
        >
          Browse Games
        </button>

        {/* Online presence list */}
        <div className="flex-1 overflow-y-auto">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Online ({presence.length})
          </p>
          <ul className="space-y-1">
            {presence.map((u) => (
              <li
                key={u.userId}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm text-gray-300"
              >
                <span className="h-2 w-2 rounded-full bg-green-400" />
                {u.username}
              </li>
            ))}
          </ul>
        </div>

        {/* Connection status */}
        <div className="mt-4 flex items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-red-500"}`}
          />
          <span className={connected ? "text-gray-400" : "text-red-400"}>
            {connected ? "Connected" : "Connecting…"}
          </span>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex flex-1 flex-col">
        {/* Header */}
        <header className="border-b border-gray-700 bg-gray-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Global Chat</h2>
          <p className="text-xs text-gray-500">
            Chat with other wizards while waiting for a match
          </p>
        </header>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-4 rounded border border-red-500 bg-red-900/30 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 && !error && (
            <p className="text-sm text-gray-600 italic">No messages yet. Say hello!</p>
          )}
          <ul className="space-y-1">
            {messages.map((msg) => (
              <li key={msg.id} className="text-sm leading-relaxed">
                <span className="font-semibold text-purple-400">{msg.username}</span>
                <span className="text-gray-500">: </span>
                <span className="text-gray-200">{msg.text}</span>
              </li>
            ))}
          </ul>
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <footer className="border-t border-gray-700 bg-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              type="text"
              placeholder="Type a message… (Enter to send, Esc to blur)"
              maxLength={MAX_CHARS}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!connected}
            />
            <button
              className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
              onClick={sendMessage}
              disabled={!connected || !inputText.trim()}
              type="button"
            >
              Send
            </button>
          </div>
          {inputText.length > MAX_CHARS * 0.85 && (
            <p className="mt-1 text-right text-xs text-gray-500">
              {inputText.length}/{MAX_CHARS}
            </p>
          )}
        </footer>
      </main>
    </div>
  )
}
