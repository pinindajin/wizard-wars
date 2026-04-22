"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Client, type Room } from "@colyseus/sdk"

import { getColyseusUrl } from "@/lib/endpoints"
import { RoomEvent } from "@/shared/roomEvents"
import type {
  LobbyPhase,
  LobbyStatePayload,
  MatchCountdownStartPayload,
  LobbyScoreboardPayload,
  ScoreboardEntry,
} from "@/shared/types"

import LoadingGate from "./LoadingGate"
import CountdownOverlay from "./CountdownOverlay"
import Scoreboard from "./Scoreboard"
import AbilityBar from "./AbilityBar"
import QuickItemBar from "./QuickItemBar"
import GameSettingsModal from "./GameSettingsModal"
import { MATCH_COUNTDOWN_DURATION_MS } from "@/shared/balance-config/lobby"
import type { ShopStatePayload } from "@/shared/types"

/** Props for LobbyGameHost. */
type LobbyGameHostProps = {
  /** Colyseus lobby/room ID. */
  readonly lobbyId: string
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

/**
 * Host component for the in-match game screen.
 * Mounts the Phaser canvas, manages the WS connection to the game_lobby room,
 * and renders HUD overlays (LoadingGate, CountdownOverlay, Scoreboard, etc.).
 *
 * @param props.lobbyId - The Colyseus room ID.
 */
export default function LobbyGameHost({ lobbyId }: LobbyGameHostProps) {
  const router = useRouter()

  const [phase, setPhase] = useState<LobbyPhase>("WAITING_FOR_CLIENTS")
  const [allPlayersLoaded, setAllPlayersLoaded] = useState(false)
  const [countdownStart, setCountdownStart] = useState<{
    startAtServerTimeMs: number
    durationMs: number
  } | null>(null)
  const [scoreboardEntries, setScoreboardEntries] = useState<
    ScoreboardEntry[] | null
  >(null)
  const [shopState, setShopState] = useState<ShopStatePayload | null>(null)
  const [health, setHealth] = useState(100)
  const [maxHealth, setMaxHealth] = useState(100)
  const [lives, setLives] = useState(3)
  const [gold, setGold] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const roomRef = useRef<Room | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Connect to the Colyseus room and wire up game events
  useEffect(() => {
    let cancelled = false

    async function connect() {
      const token = getWwToken()
      if (!token) return

      try {
        const client = new Client(getColyseusUrl())
        const room = await client.joinById<unknown>(lobbyId, { token })
        if (cancelled) { room.leave(); return }

        roomRef.current = room

        // Expose globals for the Phaser game instance
        ;(window as Window & { __wwRoomId?: string; __wwLobbyId?: string }).__wwRoomId =
          room.roomId
        ;(window as Window & { __wwRoomId?: string; __wwLobbyId?: string }).__wwLobbyId =
          lobbyId

        /** Full lobby state updates (phase transitions). */
        room.onMessage(RoomEvent.LobbyState, (payload: LobbyStatePayload) => {
          setPhase(payload.phase)
          if (payload.phase === "SCOREBOARD") {
            setCountdownStart(null)
          }
        })

        /** Loading gate cleared: all clients have signalled ready. */
        room.onMessage(RoomEvent.MatchCountdownStart, (payload: MatchCountdownStartPayload) => {
          setAllPlayersLoaded(true)
          setCountdownStart({
            startAtServerTimeMs: payload.startAtServerTimeMs,
            durationMs: payload.durationMs ?? MATCH_COUNTDOWN_DURATION_MS,
          })
        })

        /** Match GO — clear countdown overlay. */
        room.onMessage(RoomEvent.MatchGo, () => {
          setCountdownStart(null)
        })

        /** End-of-match scoreboard. */
        room.onMessage(RoomEvent.LobbyScoreboard, (payload: LobbyScoreboardPayload) => {
          setScoreboardEntries([...payload.entries])
          setPhase("SCOREBOARD")
        })

        /** Shop/economy state for HUD. */
        room.onMessage(RoomEvent.ShopState, (payload: ShopStatePayload) => {
          setShopState(payload)
          setGold(payload.gold)
        })

        /** Gold balance update. */
        room.onMessage(RoomEvent.GoldBalance, (payload: { gold: number }) => {
          setGold(payload.gold)
        })

        // Signal to server that the client scene is ready
        room.send(RoomEvent.ClientSceneReady, {})
      } catch {
        // Connection error — redirect back to lobby list
        if (!cancelled) router.push("/browse")
      }
    }

    void connect()

    return () => {
      cancelled = true
      roomRef.current?.leave()
      roomRef.current = null
    }
  }, [lobbyId, router])

  // Dynamically load and mount the Phaser game after the container is ready
  useEffect(() => {
    if (!containerRef.current) return
    let destroyGame: (() => void) | undefined

    async function mountPhaser() {
      try {
        const { mountGame } = await import("@/game/main")
        destroyGame = mountGame({
          containerId: "phaser-container",
          lobbyId,
          room: roomRef.current,
        })
      } catch {
        // Phaser not yet available in this build — silently degrade
      }
    }

    void mountPhaser()

    return () => {
      destroyGame?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open/close settings modal on Backslash key
  useEffect(() => {
    /** Handles the Backslash key to toggle the settings modal. */
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

  /**
   * Sends the `lobby_return_to_lobby` message and navigates back.
   */
  const onReturnToLobby = useCallback(() => {
    roomRef.current?.send(RoomEvent.LobbyReturnToLobby ?? "lobby_return_to_lobby", {})
    router.push(`/lobby/${lobbyId}`)
  }, [lobbyId, router])

  const abilitySlots = shopState?.abilitySlots ?? [null, null, null, null, null]
  const quickItems = shopState?.quickItemSlots ?? [
    { itemId: null, charges: 0 },
    { itemId: null, charges: 0 },
    { itemId: null, charges: 0 },
    { itemId: null, charges: 0 },
  ]

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Phaser canvas container */}
      <div
        id="phaser-container"
        ref={containerRef}
        className="absolute inset-0"
      />

      {/* Loading gate overlay */}
      {!allPlayersLoaded && <LoadingGate />}

      {/* Countdown overlay */}
      {countdownStart && (
        <CountdownOverlay
          startAtServerTimeMs={countdownStart.startAtServerTimeMs}
          durationMs={countdownStart.durationMs}
          onDone={() => setCountdownStart(null)}
        />
      )}

      {/* Scoreboard (end of match) */}
      {phase === "SCOREBOARD" && scoreboardEntries && (
        <Scoreboard
          entries={scoreboardEntries}
          onReturnToLobby={onReturnToLobby}
          isLive={false}
        />
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <GameSettingsModal onClose={() => setSettingsOpen(false)} />
      )}

      {/* HUD */}
      {phase === "IN_PROGRESS" && (
        <>
          {/* Top-left: HP / lives / gold */}
          <div className="absolute left-4 top-4 flex flex-col gap-1 rounded-lg bg-black/60 px-3 py-2 text-white text-sm backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span className="text-red-400 font-bold">HP</span>
              <div className="h-3 w-32 rounded bg-gray-700">
                <div
                  className="h-3 rounded bg-red-500 transition-all"
                  style={{ width: `${(health / maxHealth) * 100}%` }}
                />
              </div>
              <span className="text-gray-300 tabular-nums">{health}/{maxHealth}</span>
            </div>
            <div className="flex gap-4 text-xs text-gray-300">
              <span>❤️ {lives} lives</span>
              <span>🪙 {gold} gold</span>
            </div>
          </div>

          {/* Bottom: ability bar + quick items */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
            <AbilityBar slots={abilitySlots} room={roomRef.current} />
            <QuickItemBar slots={quickItems} room={roomRef.current} />
          </div>

          {/* Backslash hint */}
          <div className="absolute bottom-4 right-4 text-xs text-gray-600">
            \ Settings
          </div>
        </>
      )}
    </div>
  )
}
