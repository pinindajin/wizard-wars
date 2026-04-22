"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"

import {
  LobbyHeader,
  LobbyPanel,
  LobbyShell,
  LobbyStatusPill,
} from "@/components/lobby/LobbyChrome"
import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import {
  LobbyChatPayload,
  LobbyHostTransferPayload,
  LobbyKickedPayload,
  LobbyErrorPayload,
  type LobbyPhase,
} from "@/shared/types"
import { WsEvent } from "@/shared/events"
import { useLobbyConnection } from "./LobbyConnectionProvider"
import { useLobbyMusic } from "./LobbyMusicContext"
import {
  btnGhost,
  btnGhostCompact,
  btnPrimary,
  btnSuccessBlock,
  cardInset,
  cardPanel,
  cardPanelKicked,
  chatViewport,
  errorBanner,
  inputChat,
  lobbyMainGrid,
  lobbySidebarStack,
  messageBody,
  messageName,
  messageSep,
  metaText,
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
 * Maps a lobby phase to the shared status-pill tone.
 *
 * @param currentPhase - The current lobby phase.
 * @returns Visual tone for the shared status-pill component.
 */
function getPhaseTone(
  currentPhase: LobbyPhase,
): "neutral" | "accent" | "success" | "warning" | "danger" {
  if (currentPhase === "LOBBY") return "success"
  if (currentPhase === "WAITING_FOR_CLIENTS" || currentPhase === "COUNTDOWN") return "warning"
  if (currentPhase === "IN_PROGRESS") return "danger"
  return "neutral"
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
  const phase: LobbyPhase = (lobbyState?.phase ?? "LOBBY") as LobbyPhase
  const hostPlayerId = lobbyState?.hostPlayerId
  const isHost = localPlayerId !== null && localPlayerId === hostPlayerId
  const myPlayer = players.find((p) => p.playerId === localPlayerId)

  // ─── Render: Fatal error ───────────────────────────────────────────────────

  if (providerError) {
    return (
      <LobbyShell>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="max-w-md text-center">
            <div className={`${cardPanel} p-8`}>
              <h1 className="mb-4 text-3xl font-bold text-red-400">Lobby Not Found</h1>
              <p className="mb-8 text-slate-400">{providerError}</p>
              <Link
                href="/browse"
                className="inline-block rounded-2xl bg-violet-500 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(139,92,246,0.28)] hover:bg-violet-400"
              >
                Back to Browser
              </Link>
            </div>
          </div>
        </div>
      </LobbyShell>
    )
  }

  // ─── Render: Kicked overlay ─────────────────────────────────────────────────

  if (kicked) {
    return (
      <LobbyShell>
        <div className="flex min-h-[65vh] items-center justify-center">
          <div className={cardPanelKicked}>
            <p className={metaText}>Lobby Access Removed</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-red-200">Kicked</p>
            <p className="mt-3 text-slate-300">{kicked}</p>
            <p className="mt-5 text-sm text-slate-500">Redirecting to browse…</p>
          </div>
        </div>
      </LobbyShell>
    )
  }

  return (
    <LobbyShell>
      {countdown !== null && countdown > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-[32px] border border-violet-400/25 bg-slate-950/90 px-10 py-9 text-center shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <p className={metaText}>Match Countdown</p>
            <p className="mt-4 text-8xl font-bold tabular-nums text-violet-300">{countdown}</p>
            <p className="mt-4 text-xl text-slate-200">Match starting…</p>
          </div>
        </div>
      )}

      <LobbyHeader
        eyebrow="Wizard Wars"
        title="Story Lobby"
        subtitle={`Room ${roomId}`}
        aside={
          <>
            <button className={btnGhost} onClick={goBack} type="button">
              Browse Lobbies
            </button>
            <LobbyStatusPill tone={isConnected ? getPhaseTone(phase) : "warning"}>
              <span
                className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-300" : "bg-amber-300"}`}
              />
              {isConnected ? phase.replaceAll("_", " ") : "Connecting…"}
            </LobbyStatusPill>
            <button
              className={btnGhostCompact}
              onClick={toggleMute}
              type="button"
              title={muted ? "Unmute lobby music" : "Mute lobby music"}
            >
              {muted ? "Muted" : "Music On"}
            </button>
          </>
        }
      />

      {hostTransferBanner && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-violet-500/30 bg-violet-950/50 px-4 py-2 text-sm text-violet-200">
          <span>{hostTransferBanner}</span>
          <button
            onClick={() => setHostTransferBanner(null)}
            className="ml-4 text-violet-300 hover:text-violet-100"
            type="button"
          >
            ×
          </button>
        </div>
      )}

      {lobbyError && <div className={`mb-6 ${errorBanner}`}>{lobbyError}</div>}

      <div className={lobbyMainGrid}>
        <div className={lobbySidebarStack}>
          <LobbyPanel
            eyebrow="Hero Select"
            title="Choose Your Hero"
            subtitle="Lock in your class before the host starts the match."
            aside={
              myPlayer?.heroId ? (
                <LobbyStatusPill tone="accent">
                  {HERO_CONFIGS[myPlayer.heroId]?.displayName ?? "Selected"}
                </LobbyStatusPill>
              ) : null
            }
          >
            <div className="space-y-3">
              {HERO_CARDS.map((hero) => {
                const selected = myPlayer?.heroId === hero.id
                return (
                  <button
                    key={hero.id}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      selected
                        ? `${HERO_ACCENT[hero.id]} bg-white/8 font-semibold text-white`
                        : `border-white/10 bg-white/3 text-slate-200 ${HERO_ACCENT[hero.id]}`
                    } ${!isConnected ? "cursor-not-allowed opacity-50" : ""}`}
                    onClick={() => selectHero(hero.id)}
                    type="button"
                    disabled={!isConnected}
                  >
                    <span className="text-lg">{HERO_ICON[hero.id]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-white">{hero.displayName}</p>
                      <p className="mt-1 text-xs text-slate-400">Ready for arena combat</p>
                    </div>
                    {selected ? (
                      <LobbyStatusPill tone="accent" className="shrink-0">
                        Selected
                      </LobbyStatusPill>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </LobbyPanel>

          <LobbyPanel
            eyebrow="Roster"
            title={`Players (${players.length}/12)`}
            subtitle={isHost ? "You are hosting this lobby." : "Waiting for the host to begin."}
            aside={
              <LobbyStatusPill tone={isHost ? "accent" : "neutral"}>
                {isHost ? "Host Controls Enabled" : "Guest"}
              </LobbyStatusPill>
            }
          >
            <ul className="space-y-3">
              {players.map((p) => (
                <li key={p.playerId} className={cardInset}>
                  <div className="flex items-center gap-3">
                    <span className="text-base">{HERO_ICON[p.heroId] ?? "⚪"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{p.username}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {HERO_CONFIGS[p.heroId]?.displayName ?? p.heroId}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {p.isHost ? <LobbyStatusPill tone="accent">Host</LobbyStatusPill> : null}
                      {p.playerId === localPlayerId ? (
                        <LobbyStatusPill tone="neutral">You</LobbyStatusPill>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex flex-col gap-2">
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
          </LobbyPanel>
        </div>

        <LobbyPanel
          eyebrow="Lobby Chat"
          title="Party Chat"
          subtitle="Coordinate heroes, confirm readiness, and keep everyone aligned before the match begins."
          className="min-h-144"
          contentClassName="flex h-full flex-col"
          aside={<LobbyStatusPill tone="neutral">{chatMessages.length} messages</LobbyStatusPill>}
        >
          <div
            className={`${chatViewport} mb-4 flex-1 overflow-y-auto`}
            style={{ maxHeight: "400px" }}
          >
            {chatMessages.length === 0 ? (
              <p className="text-sm italic text-slate-400">No messages yet. Say hello!</p>
            ) : null}
            <ul className="space-y-3">
              {chatMessages.map((msg) => (
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
            <div ref={chatEndRef} />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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

          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <span>
              {isConnected
                ? "Press Enter to send instantly."
                : "Waiting for lobby connection."}
            </span>
            <span className="font-mono">{roomId}</span>
          </div>
        </LobbyPanel>
      </div>
    </LobbyShell>
  )
}
