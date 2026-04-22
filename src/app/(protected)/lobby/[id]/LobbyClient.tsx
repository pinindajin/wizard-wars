"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Client, type Room } from "@colyseus/sdk"

import { getColyseusUrl } from "@/lib/endpoints"
import { RoomEvent } from "@/shared/roomEvents"
import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import type {
  LobbyPlayer,
  LobbyPhase,
  LobbyStatePayload,
  LobbyChatPayload,
  LobbyChatHistoryPayload,
  LobbyHeroSelectPayload,
  LobbyCountdownPayload,
  LobbyHostTransferPayload,
  LobbyKickedPayload,
  LobbyErrorPayload,
} from "@/shared/types"
import { useLobbyMusic } from "./LobbyMusicContext"

/** Maximum lobby chat message length. */
const MAX_CHARS = 200

/**
 * Hero card display configuration for the hero select UI.
 */
const HERO_CARDS = Object.values(HERO_CONFIGS)

/** Tint integer → Tailwind border/accent class */
const HERO_ACCENT: Record<string, string> = {
  red_wizard: "border-red-500 hover:bg-red-900/30",
  barbarian: "border-orange-500 hover:bg-orange-900/30",
  ranger: "border-green-500 hover:bg-green-900/30",
}

/** Tint integer → icon colour character */
const HERO_ICON: Record<string, string> = {
  red_wizard: "🔴",
  barbarian: "🟠",
  ranger: "🟢",
}

/**
 * Parses the `ww-token` value from `document.cookie`.
 *
 * @returns The JWT token string, or an empty string if not found.
 */
function getWwToken(): string {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("ww-token="))
  return match ? match.split("=").slice(1).join("=") : ""
}

/** Props for LobbyClient. */
type LobbyClientProps = {
  /** Colyseus room ID passed from the server page. */
  readonly roomId: string
}

/**
 * Main lobby UI client component.
 * Connects to the `game_lobby` Colyseus room, shows player list,
 * hero select, lobby chat, and host controls.
 *
 * @param props.roomId - The Colyseus room ID to join.
 */
export default function LobbyClient({ roomId }: LobbyClientProps) {
  const router = useRouter()
  const { muted, toggleMute, onFirstInteraction } = useLobbyMusic()

  const [phase, setPhase] = useState<LobbyPhase>("LOBBY")
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [hostPlayerId, setHostPlayerId] = useState<string | null>(null)
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<LobbyChatPayload[]>([])
  const [chatInput, setChatInput] = useState("")
  const [countdown, setCountdown] = useState<number | null>(null)
  const [connected, setConnected] = useState(false)
  const [kicked, setKicked] = useState<string | null>(null)
  const [lobbyError, setLobbyError] = useState<string | null>(null)

  const roomRef = useRef<Room | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)

  /** Scrolls the lobby chat to the bottom. */
  const scrollChat = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollChat()
  }, [chatMessages, scrollChat])

  // Connect to the Colyseus game_lobby room
  useEffect(() => {
    let cancelled = false

    async function connect() {
      const token = getWwToken()
      if (!token) {
        setLobbyError("Not authenticated")
        return
      }

      try {
        const client = new Client(getColyseusUrl())
        const room = await client.joinById<unknown>(roomId, { token })
        if (cancelled) {
          room.leave()
          return
        }

        roomRef.current = room
        setConnected(true)
        // The server sends the sessionId which equals the playerId
        setMyPlayerId(room.sessionId)

        /** Full lobby state snapshot (on join + phase transitions). */
        room.onMessage(RoomEvent.LobbyState, (payload: LobbyStatePayload) => {
          setPhase(payload.phase)
          setPlayers([...payload.players])
          setHostPlayerId(payload.hostPlayerId)
          if (payload.phase === "IN_PROGRESS") {
            router.push(`/lobby/${roomId}/game`)
          }
        })

        /** Incremental lobby chat message. */
        room.onMessage(RoomEvent.LobbyChat, (msg: LobbyChatPayload) => {
          setChatMessages((prev) => [...prev, msg])
        })

        /** Chat history replay on join. */
        room.onMessage(
          RoomEvent.LobbyChatHistory,
          (payload: LobbyChatHistoryPayload) => {
            setChatMessages([...payload.messages])
          },
        )

        /** Hero select update for a specific player. */
        room.onMessage(
          RoomEvent.LobbyHeroSelect,
          (payload: LobbyHeroSelectPayload) => {
            setPlayers((prev) =>
              prev.map((p) =>
                p.playerId === payload.playerId
                  ? { ...p, heroId: payload.heroId }
                  : p,
              ),
            )
          },
        )

        /** Countdown tick before IN_PROGRESS. */
        room.onMessage(
          RoomEvent.LobbyCountdown,
          (payload: LobbyCountdownPayload) => {
            setCountdown(payload.remaining)
            if (payload.remaining <= 0) {
              setCountdown(null)
            }
          },
        )

        /** Host transfer after prior host disconnects. */
        room.onMessage(
          RoomEvent.LobbyHostTransfer,
          (payload: LobbyHostTransferPayload) => {
            setHostPlayerId(payload.hostPlayerId)
          },
        )

        /** Kicked from lobby. */
        room.onMessage(RoomEvent.LobbyKicked, (payload: LobbyKickedPayload) => {
          setKicked(payload.reason)
          setTimeout(() => router.push("/browse"), 2500)
        })

        /** Generic lobby error. */
        room.onMessage(RoomEvent.LobbyError, (payload: LobbyErrorPayload) => {
          setLobbyError(payload.message)
        })

        room.onLeave(() => {
          if (!cancelled) setConnected(false)
        })

        room.onError((_code, message) => {
          if (!cancelled) setLobbyError(message ?? "Room error")
        })
      } catch (err) {
        if (!cancelled) {
          setLobbyError(
            err instanceof Error ? err.message : "Failed to connect to lobby",
          )
        }
      }
    }

    void connect()

    return () => {
      cancelled = true
      roomRef.current?.leave()
      roomRef.current = null
    }
  }, [roomId, router])

  /**
   * Sends a hero selection to the server.
   *
   * @param heroId - The ID of the hero to select.
   */
  const selectHero = useCallback((heroId: string) => {
    roomRef.current?.send(RoomEvent.LobbyHeroSelect, { heroId })
  }, [])

  /**
   * Sends the start game command (host only).
   */
  const startGame = useCallback(() => {
    roomRef.current?.send(RoomEvent.LobbyStartGame, {})
  }, [])

  /**
   * Sends a lobby chat message.
   */
  const sendChat = useCallback(() => {
    const text = chatInput.trim()
    if (!text || !roomRef.current || text.length > MAX_CHARS) return
    roomRef.current.send(RoomEvent.LobbyChat, { text })
    setChatInput("")
  }, [chatInput])

  /**
   * Handles keydown events on the chat input.
   * Enter sends the message; Escape blurs the input.
   *
   * @param e - The keyboard event.
   */
  const onChatKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault()
        sendChat()
      } else if (e.key === "Escape") {
        chatInputRef.current?.blur()
      }
    },
    [sendChat],
  )

  /**
   * Navigates back to the browse games page.
   */
  const goBack = useCallback(() => {
    router.push("/browse")
  }, [router])

  const isHost = myPlayerId !== null && myPlayerId === hostPlayerId
  const myPlayer = players.find((p) => p.playerId === myPlayerId)

  // ----- Render: Kicked overlay -----
  if (kicked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
        <div className="rounded-xl border border-red-600 bg-gray-800 p-8 text-center shadow-2xl">
          <p className="text-2xl font-bold text-red-400">Kicked</p>
          <p className="mt-2 text-gray-400">{kicked}</p>
          <p className="mt-4 text-sm text-gray-600">Redirecting to browse…</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex min-h-screen bg-gray-900 text-white"
      onClick={onFirstInteraction}
    >
      {/* Countdown overlay */}
      {countdown !== null && countdown > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="text-center">
            <p className="text-8xl font-bold text-purple-400 tabular-nums">
              {countdown}
            </p>
            <p className="mt-4 text-xl text-gray-300">Match starting…</p>
          </div>
        </div>
      )}

      {/* Left panel: hero select + player list */}
      <aside className="flex w-72 flex-col border-r border-gray-700 bg-gray-800">
        {/* Back + mute controls */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <button
            className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-700"
            onClick={goBack}
            type="button"
          >
            ← Browse
          </button>
          <button
            className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-700"
            onClick={toggleMute}
            type="button"
            title={muted ? "Unmute lobby music" : "Mute lobby music"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>

        {/* Lobby info */}
        <div className="border-b border-gray-700 px-4 py-3">
          <p className="text-xs text-gray-500">Room ID</p>
          <p className="font-mono text-xs text-gray-300">{roomId}</p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-red-500"}`}
            />
            <span className={`text-xs ${connected ? "text-gray-400" : "text-red-400"}`}>
              {connected ? `Phase: ${phase}` : "Connecting…"}
            </span>
          </div>
        </div>

        {/* Hero Select */}
        <div className="border-b border-gray-700 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Select Hero
          </p>
          <div className="space-y-2">
            {HERO_CARDS.map((hero) => {
              const selected = myPlayer?.heroId === hero.id
              return (
                <button
                  key={hero.id}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? `${HERO_ACCENT[hero.id]} bg-opacity-30 font-semibold text-white`
                      : `border-gray-600 text-gray-300 ${HERO_ACCENT[hero.id]}`
                  }`}
                  onClick={() => selectHero(hero.id)}
                  type="button"
                >
                  <span className="text-lg">{HERO_ICON[hero.id]}</span>
                  <span>{hero.displayName}</span>
                  {selected && (
                    <span className="ml-auto text-xs text-purple-400">✓ Selected</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Player list */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Players ({players.length}/12)
          </p>
          <ul className="space-y-2">
            {players.map((p) => (
              <li
                key={p.playerId}
                className="flex items-center gap-2 rounded-lg bg-gray-900/50 px-3 py-2"
              >
                <span className="text-base">
                  {HERO_ICON[p.heroId] ?? "⚪"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {p.username}
                  </p>
                  <p className="text-xs text-gray-500">
                    {HERO_CONFIGS[p.heroId]?.displayName ?? p.heroId}
                  </p>
                </div>
                {p.isHost && (
                  <span className="rounded bg-purple-700 px-1.5 py-0.5 text-xs text-purple-200">
                    Host
                  </span>
                )}
                {p.playerId === myPlayerId && (
                  <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-400">
                    You
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Host: start game button */}
        {isHost && phase === "LOBBY" && (
          <div className="border-t border-gray-700 p-4">
            <button
              className="w-full rounded-md bg-green-600 py-3 text-sm font-bold hover:bg-green-700 active:bg-green-800 disabled:opacity-50"
              onClick={startGame}
              disabled={players.length === 0}
              type="button"
            >
              ▶ Start Game
            </button>
          </div>
        )}
      </aside>

      {/* Main: lobby chat */}
      <main className="flex flex-1 flex-col">
        <header className="border-b border-gray-700 bg-gray-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Lobby Chat</h2>
          {lobbyError && (
            <p className="mt-1 text-xs text-red-400">{lobbyError}</p>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {chatMessages.length === 0 && (
            <p className="text-sm italic text-gray-600">
              No messages yet. Say hello!
            </p>
          )}
          <ul className="space-y-1">
            {chatMessages.map((msg) => (
              <li key={msg.id} className="text-sm leading-relaxed">
                <span className="font-semibold text-purple-400">
                  {msg.username}
                </span>
                <span className="text-gray-500">: </span>
                <span className="text-gray-200">{msg.text}</span>
              </li>
            ))}
          </ul>
          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <footer className="border-t border-gray-700 bg-gray-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <input
              ref={chatInputRef}
              className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              type="text"
              placeholder="Chat… (Enter to send)"
              maxLength={MAX_CHARS}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={onChatKeyDown}
              disabled={!connected}
            />
            <button
              className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
              onClick={sendChat}
              disabled={!connected || !chatInput.trim()}
              type="button"
            >
              Send
            </button>
          </div>
        </footer>
      </main>
    </div>
  )
}
