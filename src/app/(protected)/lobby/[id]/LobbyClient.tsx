"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"

import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import {
  LobbyChatPayload,
  LobbyHostTransferPayload,
  LobbyKickedPayload,
  LobbyErrorPayload,
} from "@/shared/types"
import { WsEvent } from "@/shared/events"
import { useLobbyConnection } from "./LobbyConnectionProvider"
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

/**
 * Main lobby UI client component.
 * Uses the shared `LobbyConnectionProvider` to interact with the game room.
 * Shows player list, hero select, lobby chat, and host controls.
 */
export default function LobbyClient() {
  const router = useRouter()
  const params = useParams()
  const roomId = typeof params?.id === "string" ? params.id : ""
  const { muted, toggleMute } = useLobbyMusic()
  const {
    connection,
    lobbyState,
    localPlayerId,
    error: providerError,
    isConnected,
    onMessage,
  } = useLobbyConnection()

  const [chatMessages, setChatMessages] = useState<LobbyChatPayload[]>([])
  const [chatInput, setChatInput] = useState("")
  const [countdown, setCountdown] = useState<number | null>(null)
  const [kicked, setKicked] = useState<string | null>(null)
  const [lobbyError, setLobbyError] = useState<string | null>(null)
  const [hostTransferBanner, setHostTransferBanner] = useState<string | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)

  /** Scrolls the lobby chat to the bottom. */
  const scrollChat = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollChat()
  }, [chatMessages, scrollChat])

  // Wire incoming message handlers from the transport layer
  useEffect(() => {
    const unsub = onMessage((message) => {
      switch (message.type) {
        case WsEvent.LobbyChat:
          setChatMessages((prev) => [...prev, message.payload as LobbyChatPayload])
          break

        case WsEvent.LobbyChatHistory:
          setChatMessages([...(message.payload as { messages: LobbyChatPayload[] }).messages])
          break

        case WsEvent.LobbyCountdown:
          setCountdown((message.payload as { remaining: number }).remaining)
          break

        case WsEvent.LobbyHostTransfer: {
          const payload = message.payload as LobbyHostTransferPayload
          setHostTransferBanner(`${payload.hostUsername} is now the host`)
          break
        }

        case WsEvent.LobbyKicked:
          setKicked((message.payload as LobbyKickedPayload).reason)
          setTimeout(() => router.push("/browse"), 2500)
          break

        case WsEvent.LobbyError:
          setLobbyError((message.payload as LobbyErrorPayload).message)
          break

        case WsEvent.LobbyState: {
          const payload = message.payload as import("@/shared/types").LobbyStatePayload
          // Clear countdown if server cancels it (returns to LOBBY phase)
          if (payload.phase === "LOBBY") {
            setCountdown(null)
          }
          if (payload.phase === "IN_PROGRESS") {
            router.push(`/lobby/${roomId}/game`)
          }
          break
        }
      }
    })

    return unsub
  }, [onMessage, router, roomId])

  // Auto-dismiss host transfer banner after 5 seconds
  useEffect(() => {
    if (!hostTransferBanner) return
    const t = setTimeout(() => setHostTransferBanner(null), 5000)
    return () => clearTimeout(t)
  }, [hostTransferBanner])

  /** Sends a hero selection to the server. */
  const selectHero = useCallback(
    (heroId: string) => {
      connection?.sendLobbyHeroSelect(heroId)
    },
    [connection],
  )

  /** Sends the start game command (host only). */
  const startGame = useCallback(() => {
    connection?.sendLobbyStartGame()
  }, [connection])

  /** Sends the end lobby command (host only). */
  const endLobby = useCallback(() => {
    connection?.sendLobbyEndLobby()
  }, [connection])

  /** Sends a lobby chat message. */
  const sendChat = useCallback(() => {
    const text = chatInput.trim()
    if (!text || !connection || text.length > MAX_CHARS) return
    connection.sendLobbyChat(text)
    setChatInput("")
  }, [chatInput, connection])

  /** Handles keydown events on the chat input. */
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

  /** Navigates back to the browse games page. */
  const goBack = useCallback(() => {
    router.push("/browse")
  }, [router])

  const players = lobbyState?.players ?? []
  const phase = lobbyState?.phase ?? "LOBBY"
  const hostPlayerId = lobbyState?.hostPlayerId
  const isHost = localPlayerId !== null && localPlayerId === hostPlayerId
  const myPlayer = players.find((p) => p.playerId === localPlayerId)

  // ─── Render: Fatal error ───────────────────────────────────────────────────

  if (providerError) {
    return (
      <div className={`flex items-center justify-center ${pageShell}`}>
        <div className="max-w-md text-center">
          <div className={`${cardPanel} p-8`}>
            <h1 className="mb-4 text-3xl font-bold text-red-400">Lobby Not Found</h1>
            <p className="mb-8 text-gray-400">{providerError}</p>
            <Link
              href="/browse"
              className="inline-block rounded-md bg-purple-600 px-6 py-2 font-semibold text-white hover:bg-purple-700"
            >
              Back to Browser
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ─── Render: Kicked overlay ─────────────────────────────────────────────────

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
            <p className="text-8xl font-bold text-purple-400 tabular-nums">{countdown}</p>
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
                className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-400" : "bg-red-500"}`}
              />
              <span className={isConnected ? "text-gray-400" : "text-red-400"}>
                {isConnected ? phase : "Connecting…"}
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

        {/* Host transfer banner */}
        {hostTransferBanner && (
          <div className="mb-4 flex items-center justify-between rounded-lg bg-purple-900/40 px-4 py-2 text-sm text-purple-200 border border-purple-500/30">
            <span>{hostTransferBanner}</span>
            <button
              onClick={() => setHostTransferBanner(null)}
              className="ml-4 text-purple-400 hover:text-purple-200"
              type="button"
            >
              ×
            </button>
          </div>
        )}

        {lobbyError && <div className={`mb-4 ${errorBanner}`}>{lobbyError}</div>}

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
                      } ${!isConnected ? "opacity-50 cursor-not-allowed" : ""}`}
                      onClick={() => selectHero(hero.id)}
                      type="button"
                      disabled={!isConnected}
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
              <p className={`mb-3 ${sectionTitleCaps}`}>Players ({players.length}/12)</p>
              <ul className="space-y-2">
                {players.map((p) => (
                  <li
                    key={p.playerId}
                    className="flex items-center gap-2 rounded-lg bg-gray-900/50 px-3 py-2"
                  >
                    <span className="text-base">{HERO_ICON[p.heroId] ?? "⚪"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{p.username}</p>
                      <p className="text-xs text-gray-500">
                        {HERO_CONFIGS[p.heroId]?.displayName ?? p.heroId}
                      </p>
                    </div>
                    {p.isHost && (
                      <span className="rounded bg-purple-700 px-1.5 py-0.5 text-xs text-purple-200">
                        Host
                      </span>
                    )}
                    {p.playerId === localPlayerId && (
                      <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-400">
                        You
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {/* Start/End game/lobby affordances */}
              <div className="mt-4 flex flex-col gap-2">
                {phase === "LOBBY" && (
                  <button
                    className={btnSuccessBlock}
                    onClick={startGame}
                    disabled={!isHost || !isConnected || players.length === 0}
                    type="button"
                    title={!isHost ? "Only the host can start the game" : undefined}
                  >
                    {!isConnected
                      ? "Connecting…"
                      : isHost
                        ? "▶ Start Game"
                        : "Waiting for Host…"}
                  </button>
                )}

                {(isHost || phase === "IN_PROGRESS") && (
                  <div className="flex gap-2">
                    {isHost &&
                      (phase === "LOBBY" || phase === "SCOREBOARD" || phase === "COUNTDOWN") && (
                        <button
                          className={`${btnGhost} flex-1 border-red-900/50 text-red-400 hover:bg-red-900/20`}
                          onClick={endLobby}
                          type="button"
                        >
                          End Lobby
                        </button>
                      )}

                    {phase === "IN_PROGRESS" && (
                      <Link
                        href={`/lobby/${roomId}/game`}
                        className={`${btnPrimary} flex-1 text-center text-sm`}
                      >
                        Join Game In Progress
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right 2 columns: lobby chat */}
          <div className={`${cardPanel} ${gridChatSpan}`}>
            <h2 className={`mb-3 ${sectionTitle}`}>Lobby Chat</h2>

            {/* Messages */}
            <div className="mb-3 flex-1 overflow-y-auto" style={{ maxHeight: "400px" }}>
              {chatMessages.length === 0 && (
                <p className="text-sm italic text-gray-600">No messages yet. Say hello!</p>
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
                disabled={!isConnected}
              />
              <button
                className={btnPrimary}
                onClick={sendChat}
                disabled={!isConnected || !chatInput.trim()}
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
