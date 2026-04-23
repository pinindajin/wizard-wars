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
} from "@/shared/types"

import LoadingGate from "./LoadingGate"
import CountdownOverlay from "./CountdownOverlay"
import { hudTopPanel } from "@/lib/ui/lobbyStyles"
import Scoreboard from "./Scoreboard"
import AbilityBar from "./AbilityBar"
import QuickItemBar from "./QuickItemBar"
import GameSettingsModal from "./GameSettingsModal"
import { GameKeybindProvider } from "./GameKeybindContext"
import { useLobbyConnection } from "../LobbyConnectionProvider"
import { MATCH_COUNTDOWN_DURATION_MS } from "@/shared/balance-config/lobby"
import type { ShopStatePayload } from "@/shared/types"

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
  const [phaserError, setPhaserError] = useState<string | null>(null)
  const [mountGeneration, setMountGeneration] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)

  const colyseusRoom: Room | null = connection?.room ?? null

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
          break
        case WsEvent.LobbyScoreboard: {
          const payload = message.payload as LobbyScoreboardPayload
          setScoreboardEntries([...payload.entries])
          setPhase("SCOREBOARD")
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
  }, [connection])

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
        destroyGame = mountGame({
          containerId: "phaser-container",
          lobbyId,
          token,
          gameConnection: connection,
          localPlayerId,
        })
        if (typeof window !== "undefined") {
          const w = window as Window & { __wwRoomId?: string; __wwLobbyId?: string }
          w.__wwRoomId = connection.room?.roomId
          w.__wwLobbyId = lobbyId
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

        {!allPlayersLoaded && <LoadingGate />}

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

        {phase === "IN_PROGRESS" && (
          <>
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

            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
              <AbilityBar slots={abilitySlots} room={colyseusRoom} />
              <QuickItemBar slots={quickItems} room={colyseusRoom} />
            </div>

            <div className="absolute bottom-4 right-4 rounded border border-gray-700/50 bg-black/40 px-2 py-1 text-xs text-gray-500 backdrop-blur-sm">
              \ Settings
            </div>
          </>
        )}
      </div>
    </GameKeybindProvider>
  )
}
