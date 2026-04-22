"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Client, type Room } from "@colyseus/sdk"

import {
  LobbyHeader,
  LobbyPanel,
  LobbyShell,
  LobbyStatusPill,
} from "@/components/lobby/LobbyChrome"
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
  btnGhost,
  btnGhostCompact,
  btnPrimary,
  btnSuccessBlock,
  cardInset,
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

/** Props for LobbyClient. */
type LobbyClientProps = {
  /** Colyseus room ID passed from the server page. */
  readonly roomId: string
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
        room.onMessage(RoomEvent.LobbyChatHistory, (payload: LobbyChatHistoryPayload) => {
          setChatMessages([...payload.messages])
        })

        /** Hero select update for a specific player. */
        room.onMessage(RoomEvent.LobbyHeroSelect, (payload: LobbyHeroSelectPayload) => {
          setPlayers((prev) =>
            prev.map((p) => (p.playerId === payload.playerId ? { ...p, heroId: payload.heroId } : p)),
          )
        })

        /** Countdown tick before IN_PROGRESS. */
        room.onMessage(RoomEvent.LobbyCountdown, (payload: LobbyCountdownPayload) => {
          setCountdown(payload.remaining)
          if (payload.remaining <= 0) {
            setCountdown(null)
          }
        })

        /** Host transfer after prior host disconnects. */
        room.onMessage(RoomEvent.LobbyHostTransfer, (payload: LobbyHostTransferPayload) => {
          setHostPlayerId(payload.hostPlayerId)
        })

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
          setLobbyError(err instanceof Error ? err.message : "Failed to connect to lobby")
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
      <LobbyShell>
        <div className="flex min-h-[65vh] items-center justify-center">
          <div className={cardPanelKicked}>
            <p className={metaText}>Lobby Access Removed</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-red-200">Kicked</p>
            <p className="mt-3 text-slate-300">{kicked}</p>
            <p className="mt-5 text-sm text-slate-500">Redirecting to browse...</p>
          </div>
        </div>
      </LobbyShell>
    )
  }

  return (
    <LobbyShell>
      {/* Countdown overlay */}
      {countdown !== null && countdown > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-[32px] border border-violet-400/25 bg-slate-950/90 px-10 py-9 text-center shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <p className={metaText}>Match Countdown</p>
            <p className="mt-4 text-8xl font-bold tabular-nums text-violet-300">{countdown}</p>
            <p className="mt-4 text-xl text-slate-200">Match starting...</p>
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
            <LobbyStatusPill tone={connected ? getPhaseTone(phase) : "warning"}>
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-300" : "bg-amber-300"}`} />
              {connected ? phase.replaceAll("_", " ") : "Connecting"}
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
                    }`}
                    onClick={() => selectHero(hero.id)}
                    type="button"
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
                      {p.playerId === myPlayerId ? (
                        <LobbyStatusPill tone="neutral">You</LobbyStatusPill>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {isHost && phase === "LOBBY" && (
              <div className="mt-5">
                <button
                  className={btnSuccessBlock}
                  onClick={startGame}
                  disabled={players.length === 0}
                  type="button"
                >
                  Start Game
                </button>
              </div>
            )}

            {phase === "IN_PROGRESS" && (
              <div className="mt-5">
                <Link href={`/lobby/${roomId}/game`} className={`${btnPrimary} block text-center`}>
                  Join Game In Progress
                </Link>
              </div>
            )}
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
          <div className={`${chatViewport} mb-4 flex-1 overflow-y-auto`} style={{ maxHeight: "400px" }}>
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
              placeholder="Chat... (Enter to send)"
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

          <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
            <span>{connected ? "Press Enter to send instantly." : "Waiting for lobby connection."}</span>
            <span className="font-mono">{roomId}</span>
          </div>
        </LobbyPanel>
      </div>
    </LobbyShell>
  )
}
