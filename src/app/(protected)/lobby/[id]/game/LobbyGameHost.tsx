"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { Room } from "@colyseus/sdk"

import { fetchWsAuthToken } from "@/lib/fetch-ws-auth-token"
import { WsEvent } from "@/shared/events"
import type {
  LobbyPhase,
  LobbyStatePayload,
  MatchCountdownStartPayload,
  LobbyScoreboardPayload,
  ScoreboardEntry,
  PlayerDeathPayload,
  GameStateSyncPayload,
  PlayerBatchUpdatePayload,
} from "@/shared/types"

import WaitingForPlayersOverlay from "./WaitingForPlayersOverlay"
import LoadingOverlay from "./LoadingOverlay"
import CountdownOverlay from "./CountdownOverlay"
import { useLoaderStatus } from "./useLoaderStatus"
import type { LoaderStatusHost } from "@/game/loaderStatus"
import { hudTopPanel } from "@/lib/ui/lobbyStyles"
import Scoreboard from "./Scoreboard"
import AbilityBar from "./AbilityBar"
import QuickItemBar from "./QuickItemBar"
import GameSettingsModal from "./GameSettingsModal"
import ShopModal from "./ShopModal"
import { GameKeybindProvider } from "./GameKeybindContext"
import { useLobbyConnection } from "../LobbyConnectionProvider"
import { MATCH_COUNTDOWN_DURATION_MS } from "@/shared/balance-config/lobby"
import type { ShopStatePayload } from "@/shared/types"
import KillFeed from "./KillFeed"
import { formatKillFeedLine } from "@/lib/kill-feed-format"

const KILL_FEED_MAX = 5
const KILL_FEED_TTL_MS = 8000

/** Props for LobbyGameHost. */
type LobbyGameHostProps = {
  /** Colyseus lobby/room ID. */
  readonly lobbyId: string
}

/**
 * Host component for the in-match game screen.
 * Reuses `LobbyConnectionProvider`'s Colyseus session, mounts Phaser with an injected
 * `GameConnection`, and renders HUD overlays.
 *
 * @param props.lobbyId - The Colyseus room ID.
 */
export default function LobbyGameHost({ lobbyId }: LobbyGameHostProps) {
  const router = useRouter()
  const { connection, lobbyState, error: providerError, localPlayerId } =
    useLobbyConnection()

  const [phase, setPhase] = useState<LobbyPhase>(
    () => lobbyState?.phase ?? "WAITING_FOR_CLIENTS",
  )
  const [allPlayersLoaded, setAllPlayersLoaded] = useState(
    () =>
      lobbyState?.phase != null && lobbyState.phase !== "WAITING_FOR_CLIENTS",
  )
  const [countdownStart, setCountdownStart] = useState<{
    startAtServerTimeMs: number
    durationMs: number
  } | null>(null)
  const [scoreboardEntries, setScoreboardEntries] = useState<
    ScoreboardEntry[] | null
  >(null)
  const [shopState, setShopState] = useState<ShopStatePayload | null>(null)
  /** HUD placeholders until wired to game sync messages. */
  const health = 100
  const maxHealth = 100
  const lives = 3
  const [gold, setGold] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shopOpen, setShopOpen] = useState(false)
  const [phaserError, setPhaserError] = useState<string | null>(null)
  const [mountGeneration, setMountGeneration] = useState(0)
  const [killFeedRows, setKillFeedRows] = useState<
    Array<{ key: string; text: string; at: number }>
  >([])
  const [isSpectating, setIsSpectating] = useState(false)
  const [gameHost, setGameHost] = useState<LoaderStatusHost | null>(null)
  const entityToPlayerRef = useRef<Map<number, string>>(new Map())

  const containerRef = useRef<HTMLDivElement>(null)

  const colyseusRoom: Room | null = connection?.room ?? null
  const loaderStatus = useLoaderStatus(gameHost)
  const phaserLoaded = loaderStatus?.phase === "complete"

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now()
      setKillFeedRows((rows) => rows.filter((r) => now - r.at < KILL_FEED_TTL_MS))
    }, 400)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!connection) return
    const unsub = connection.onMessage((message) => {
      switch (message.type) {
        case WsEvent.LobbyState: {
          const payload = message.payload as LobbyStatePayload
          setPhase(payload.phase)
          if (payload.phase !== "WAITING_FOR_CLIENTS") {
            setAllPlayersLoaded(true)
          }
          if (payload.phase === "SCOREBOARD") {
            setCountdownStart(null)
            setKillFeedRows([])
          }
          break
        }
        case WsEvent.MatchCountdownStart: {
          const payload = message.payload as MatchCountdownStartPayload
          setAllPlayersLoaded(true)
          setCountdownStart({
            startAtServerTimeMs: payload.startAtServerTimeMs,
            durationMs: payload.durationMs ?? MATCH_COUNTDOWN_DURATION_MS,
          })
          break
        }
        case WsEvent.MatchGo:
          setCountdownStart(null)
          setIsSpectating(false)
          entityToPlayerRef.current = new Map()
          break
        case WsEvent.GameStateSync: {
          const payload = message.payload as GameStateSyncPayload
          const m = new Map<number, string>()
          for (const pl of payload.players) {
            m.set(pl.id, pl.playerId)
          }
          entityToPlayerRef.current = m
          if (localPlayerId) {
            const me = payload.players.find((p) => p.playerId === localPlayerId)
            if (me && me.lives === 0) setIsSpectating(true)
            else if (me) setIsSpectating(false)
          }
          break
        }
        case WsEvent.PlayerBatchUpdate: {
          const payload = message.payload as PlayerBatchUpdatePayload
          if (!localPlayerId) break
          const map = entityToPlayerRef.current
          for (const d of payload.deltas) {
            if (map.get(d.id) !== localPlayerId) continue
            if (d.lives === undefined) continue
            if (d.lives === 0) setIsSpectating(true)
            else setIsSpectating(false)
          }
          break
        }
        case WsEvent.PlayerDeath: {
          const death = message.payload as PlayerDeathPayload
          const key = crypto.randomUUID()
          const text = formatKillFeedLine(death)
          setKillFeedRows((rows) => [
            ...rows.filter((r) => Date.now() - r.at < KILL_FEED_TTL_MS).slice(-(KILL_FEED_MAX - 1)),
            { key, text, at: Date.now() },
          ])
          if (localPlayerId && death.playerId === localPlayerId && death.livesRemaining === 0) {
            setIsSpectating(true)
          }
          break
        }
        case WsEvent.LobbyScoreboard: {
          const payload = message.payload as LobbyScoreboardPayload
          setScoreboardEntries([...payload.entries])
          setPhase("SCOREBOARD")
          setKillFeedRows([])
          break
        }
        case WsEvent.ShopState: {
          const payload = message.payload as ShopStatePayload
          setShopState(payload)
          setGold(payload.gold)
          break
        }
        case WsEvent.GoldBalance: {
          const payload = message.payload as { gold: number }
          setGold(payload.gold)
          break
        }
        default:
          break
      }
    })
    return unsub
  }, [connection, localPlayerId])

  useEffect(() => {
    if (!connection) return

    let destroyGame: (() => void) | undefined
    let cancelled = false

    void (async () => {
      try {
        const token = await fetchWsAuthToken()
        if (cancelled) return
        if (!token) {
          setPhaserError("Could not get session token")
          return
        }
        setPhaserError(null)
        const { mountGame } = await import("@/game/main")
        if (cancelled) return
        const mounted = mountGame({
          containerId: "phaser-container",
          lobbyId,
          token,
          gameConnection: connection,
          localPlayerId,
        })
        destroyGame = mounted.destroy
        setGameHost(mounted.game as unknown as LoaderStatusHost)
        if (typeof window !== "undefined") {
          const w = window as Window & {
            __wwRoomId?: string
            __wwLobbyId?: string
            __wwGame?: unknown
          }
          w.__wwRoomId = connection.room?.roomId
          w.__wwLobbyId = lobbyId
          w.__wwGame = mounted.game
        }
      } catch (err) {
        if (!cancelled) {
          setPhaserError(
            err instanceof Error ? err.message : "Failed to start game client",
          )
        }
      }
    })()

    return () => {
      cancelled = true
      setGameHost(null)
      destroyGame?.()
    }
  }, [connection, localPlayerId, lobbyId, mountGeneration])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement
      const isInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      if (isInput) return
      if (e.key === "\\") setSettingsOpen((prev) => !prev)
      if (e.key === "b" || e.key === "B") setShopOpen((prev) => !prev)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const onReturnToLobby = useCallback(() => {
    connection?.sendLobbyReturnToLobby()
    router.push(`/lobby/${lobbyId}`)
  }, [lobbyId, router, connection])

  const onRetryPhaser = useCallback(() => {
    setPhaserError(null)
    setMountGeneration((g) => g + 1)
  }, [])

  const abilitySlots = shopState?.abilitySlots ?? [null, null, null, null, null]
  const quickItems = shopState?.quickItemSlots ?? [
    { itemId: null, charges: 0 },
    { itemId: null, charges: 0 },
    { itemId: null, charges: 0 },
    { itemId: null, charges: 0 },
  ]

  if (providerError) {
    return (
      <div
        className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center text-gray-200"
        data-testid="game-connect-error"
      >
        <p className="max-w-md text-sm">{providerError}</p>
        <Link
          href="/browse"
          className="rounded border border-gray-600 px-4 py-2 text-sm hover:bg-gray-900"
        >
          Back to browse
        </Link>
      </div>
    )
  }

  if (!connection) {
    return (
      <div
        className="flex h-screen w-screen items-center justify-center bg-black text-gray-400"
        data-testid="game-connect-loading"
      >
        Connecting to lobby…
      </div>
    )
  }

  return (
    <GameKeybindProvider>
      <div className="relative h-screen w-screen overflow-hidden bg-black">
        <div
          id="phaser-container"
          data-testid="game-phaser-container"
          ref={containerRef}
          className="absolute inset-0"
        />

        {phaserError && (
          <div
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center"
            data-testid="game-connect-error"
          >
            <p className="max-w-md text-sm text-red-300">{phaserError}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                data-testid="game-retry"
                className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500"
                onClick={onRetryPhaser}
              >
                Retry
              </button>
              <button
                type="button"
                className="rounded border border-gray-600 px-4 py-2 text-sm text-gray-200 hover:bg-gray-900"
                onClick={() => router.replace(`/lobby/${lobbyId}`)}
              >
                Reconnect to lobby
              </button>
            </div>
          </div>
        )}

        {!phaserLoaded && <LoadingOverlay status={loaderStatus} />}

        {phaserLoaded && !allPlayersLoaded && <WaitingForPlayersOverlay />}

        {countdownStart && (
          <CountdownOverlay
            startAtServerTimeMs={countdownStart.startAtServerTimeMs}
            durationMs={countdownStart.durationMs}
            onDone={() => setCountdownStart(null)}
          />
        )}

        {phase === "SCOREBOARD" && scoreboardEntries && (
          <Scoreboard
            entries={scoreboardEntries}
            onReturnToLobby={onReturnToLobby}
            isLive={false}
          />
        )}

        {settingsOpen && (
          <GameSettingsModal onClose={() => setSettingsOpen(false)} />
        )}

        {shopOpen && phase === "IN_PROGRESS" && !isSpectating && (
          <ShopModal
            shopState={shopState}
            connection={connection}
            onClose={() => setShopOpen(false)}
          />
        )}

        {phase === "IN_PROGRESS" && (
          <>
            <KillFeed
              entries={killFeedRows.map((r) => ({ key: r.key, text: r.text }))}
            />

            {isSpectating && (
              <div
                className="absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded border border-amber-600/60 bg-amber-950/85 px-4 py-1.5 font-mono text-sm font-semibold text-amber-200 shadow-lg backdrop-blur-sm"
                data-testid="spectating-banner"
              >
                Spectating
              </div>
            )}

            <div className={hudTopPanel}>
              <div className="flex items-center gap-2">
                <span className="font-bold text-red-400">HP</span>
                <div className="h-3 w-32 rounded bg-gray-700">
                  <div
                    className="h-3 rounded bg-red-500 transition-all"
                    style={{ width: `${(health / maxHealth) * 100}%` }}
                  />
                </div>
                <span className="tabular-nums text-gray-300">
                  {health}/{maxHealth}
                </span>
              </div>
              <div className="flex gap-4 text-xs text-gray-300">
                <span>❤️ {lives} lives</span>
                <span>🪙 {gold} gold</span>
              </div>
            </div>

            {!isSpectating && (
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
                <AbilityBar slots={abilitySlots} room={colyseusRoom} />
                <QuickItemBar
                  slots={quickItems}
                  room={colyseusRoom}
                  connection={connection}
                />
              </div>
            )}

            <div className="absolute bottom-4 right-4 rounded border border-gray-700/50 bg-black/40 px-2 py-1 text-xs text-gray-500 backdrop-blur-sm">
              \ Settings
            </div>
          </>
        )}
      </div>
    </GameKeybindProvider>
  )
}
