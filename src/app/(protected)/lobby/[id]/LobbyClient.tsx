"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Client, type Room } from "@colyseus/sdk"

import { fetchWsAuthSession } from "@/lib/fetch-ws-auth-token"
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
import {
  pageShell,
  lobbyPage,
  gridThreeCols,
  gridChatSpan,
  cardPanel,
  cardPanelKicked,
  sectionTitle,
  sectionTitleCaps,
  messageName,
  messageSep,
  messageBody,
  inputChat,
  btnPrimary,
  btnSuccessBlock,
  btnGhost,
  errorBanner,
} from "@/lib/ui/lobbyStyles"

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

/** Hero → display icon */
const HERO_ICON: Record<string, string> = {
  red_wizard: "🔴",
  barbarian: "🟠",
  ranger: "🟢",
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
  const { muted, toggleMute } = useLobbyMusic()

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
  /** Monotonic id so stale async work from a prior effect does not join after unmount. */
  const connectGenerationRef = useRef(0)
  /** Chains `room.leave()` across Strict Mode remounts to avoid duplicate-session on re-join. */
  const leaveChainRef = useRef<Promise<unknown>>(Promise.resolve())

  /** Scrolls the lobby chat to the bottom. */
  const scrollChat = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollChat()
  }, [chatMessages, scrollChat])

  // Connect to the Colyseus game_lobby room
  useEffect(() => {
    const gen = ++connectGenerationRef.current
    let cancelled = false

    async function connect() {
      await leaveChainRef.current
      if (cancelled || gen !== connectGenerationRef.current) return

      const session = await fetchWsAuthSession()
      if (cancelled || gen !== connectGenerationRef.current) return
      if (!session) {
        setLobbyError("Not authenticated")
        return
      }

      try {
        const client = new Client(getColyseusUrl())
        const room = await client.joinById<unknown>(roomId, {
          token: session.token,
        })
        if (cancelled || gen !== connectGenerationRef.current) {
          await room.leave()
          return
        }

        roomRef.current = room
        setConnected(true)
        // Server playerId and hostPlayerId are JWT `sub`, not Colyseus sessionId.
        setMyPlayerId(session.sub)

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
      const room = roomRef.current
      roomRef.current = null
      leaveChainRef.current = leaveChainRef.current.then(async () => {
        if (room) await room.leave().catch(() => undefined)
      })
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
      <div className={`flex items-center justify-center ${pageShell}`}>
        <div className={cardPanelKicked}>
          <p className="text-2xl font-bold text-red-400">Kicked</p>
          <p className="mt-2 text-gray-400">{kicked}</p>
          <p className="mt-4 text-sm text-gray-600">Redirecting to browse…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={pageShell}>
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

      <div className={lobbyPage}>
        {/* Top bar: back, room info, mute */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className={btnGhost} onClick={goBack} type="button">
              ← Browse
            </button>
            <div>
              <p className="text-xs text-gray-500">Room</p>
              <p className="font-mono text-xs text-gray-300">{roomId}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-red-500"}`}
              />
              <span className={connected ? "text-gray-400" : "text-red-400"}>
                {connected ? `${phase}` : "Connecting…"}
              </span>
            </div>
            <button
              className={btnGhost}
              onClick={toggleMute}
              type="button"
              title={muted ? "Unmute lobby music" : "Mute lobby music"}
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </div>

        {lobbyError && (
          <div className={`mb-4 ${errorBanner}`}>{lobbyError}</div>
        )}

        <div className={gridThreeCols}>
          {/* Left column: hero select + player list */}
          <div className="flex flex-col gap-4">
            {/* Hero select */}
            <div className={cardPanel}>
              <p className={`mb-3 ${sectionTitleCaps}`}>Select Hero</p>
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
            <div className={cardPanel}>
              <p className={`mb-3 ${sectionTitleCaps}`}>
                Players ({players.length}/12)
              </p>
              <ul className="space-y-2">
                {players.map((p) => (
                  <li
                    key={p.playerId}
                    className="flex items-center gap-2 rounded-lg bg-gray-900/50 px-3 py-2"
                  >
                    <span className="text-base">{HERO_ICON[p.heroId] ?? "⚪"}</span>
                    <div className="min-w-0 flex-1">
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

              {/* Host: start game */}
              {isHost && phase === "LOBBY" && (
                <div className="mt-4">
                  <button
                    className={btnSuccessBlock}
                    onClick={startGame}
                    disabled={players.length === 0}
                    type="button"
                  >
                    ▶ Start Game
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right 2 columns: lobby chat */}
          <div className={`${cardPanel} ${gridChatSpan}`}>
            <h2 className={`mb-3 ${sectionTitle}`}>Lobby Chat</h2>

            {/* Messages */}
            <div
              className="mb-3 flex-1 overflow-y-auto"
              style={{ maxHeight: "400px" }}
            >
              {chatMessages.length === 0 && (
                <p className="text-sm italic text-gray-600">
                  No messages yet. Say hello!
                </p>
              )}
              <ul className="space-y-1">
                {chatMessages.map((msg) => (
                  <li key={msg.id} className="text-sm leading-relaxed">
                    <span className={messageName}>{msg.username}</span>
                    <span className={messageSep}>: </span>
                    <span className={messageBody}>{msg.text}</span>
                  </li>
                ))}
              </ul>
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="flex items-center gap-2">
              <input
                ref={chatInputRef}
                className={inputChat}
                type="text"
                placeholder="Chat… (Enter to send)"
                maxLength={MAX_CHARS}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={onChatKeyDown}
                disabled={!connected}
              />
              <button
                className={btnPrimary}
                onClick={sendChat}
                disabled={!connected || !chatInput.trim()}
                type="button"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
