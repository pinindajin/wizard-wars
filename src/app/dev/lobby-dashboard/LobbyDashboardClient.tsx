"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  DevLobbyDashboardLobby,
  DevLobbyDashboardResponse,
} from "@/app/api/dev/lobby-dashboard/route"
import type { LobbyPhase } from "@/shared/types"

const POLL_INTERVAL_MS = 2000

const PHASE_LABELS: Record<LobbyPhase, string> = {
  LOBBY: "Lobby",
  WAITING_FOR_CLIENTS: "Loading",
  COUNTDOWN: "Countdown",
  IN_PROGRESS: "In Game",
  SCOREBOARD: "Scoreboard",
}

const PLAY_STATUS_LABELS: Record<DevLobbyDashboardLobby["players"][number]["playStatus"], string> = {
  lobby_only: "Lobby",
  loading_game: "Loading",
  in_game: "In Game",
  scoreboard: "Scoreboard",
}

type ConfirmClose = {
  readonly lobby: DevLobbyDashboardLobby
  readonly playerCount: number
  readonly lobbyPhase: LobbyPhase
}

type CloseResponseBody = {
  readonly error?: string
  readonly playerCount?: number
  readonly lobbyPhase?: LobbyPhase
}

/**
 * Formats byte counts for compact dashboard display.
 *
 * @param bytes - Raw byte count.
 * @returns Human-readable byte size.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(1)} KiB`
  return `${(kib / 1024).toFixed(1)} MiB`
}

/**
 * Formats ISO timestamps for the local admin browser.
 *
 * @param value - ISO timestamp.
 * @returns Locale time string.
 */
function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
}

/**
 * Formats a millisecond duration as compact uptime text.
 *
 * @param ms - Duration in milliseconds.
 * @returns Human-readable duration.
 */
function formatUptime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/**
 * Returns CSS classes for a lobby phase badge.
 *
 * @param phase - Lobby FSM phase.
 * @returns Tailwind class string.
 */
function phaseBadgeClass(phase: LobbyPhase): string {
  if (phase === "LOBBY") return "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
  if (phase === "IN_PROGRESS") return "border-red-300/30 bg-red-500/15 text-red-100"
  if (phase === "SCOREBOARD") return "border-slate-300/20 bg-slate-500/15 text-slate-100"
  return "border-amber-300/30 bg-amber-500/15 text-amber-100"
}

/**
 * Fetches the current dashboard payload.
 *
 * @returns Dashboard response.
 */
async function fetchDashboard(): Promise<DevLobbyDashboardResponse> {
  const res = await fetch("/api/dev/lobby-dashboard", { credentials: "include" })
  if (!res.ok) throw new Error("Failed to load lobby dashboard")
  return (await res.json()) as DevLobbyDashboardResponse
}

/**
 * Admin lobby dashboard client component.
 *
 * @returns Rendered dashboard.
 */
export function LobbyDashboardClient() {
  const [data, setData] = useState<DevLobbyDashboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closingLobbyId, setClosingLobbyId] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState<ConfirmClose | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const lobbies = useMemo(() => data?.lobbies ?? [], [data])
  const totals = useMemo(
    () => ({
      lobbies: lobbies.length,
      players: lobbies.reduce((sum, lobby) => sum + lobby.connectedPlayerCount, 0),
      bandwidth: lobbies.reduce((sum, lobby) => sum + lobby.bandwidth.totalBytes, 0),
    }),
    [lobbies],
  )

  const loadDashboard = useCallback(async () => {
    try {
      const next = await fetchDashboard()
      setData(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lobby dashboard")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initialLoad = setTimeout(() => void loadDashboard(), 0)
    pollRef.current = setInterval(() => void loadDashboard(), POLL_INTERVAL_MS)
    return () => {
      clearTimeout(initialLoad)
      if (pollRef.current !== null) clearInterval(pollRef.current)
    }
  }, [loadDashboard])

  const requestCloseLobby = useCallback(
    async (lobby: DevLobbyDashboardLobby, confirmed = false) => {
      setClosingLobbyId(lobby.lobbyId)
      setError(null)
      try {
        const res = await fetch(`/api/lobbies/${encodeURIComponent(lobby.lobbyId)}/close`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmed }),
        })
        const body = (await res.json().catch(() => ({}))) as CloseResponseBody
        if (res.status === 409 && body.error === "confirmation_required") {
          setConfirmClose({
            lobby,
            playerCount: typeof body.playerCount === "number" ? body.playerCount : lobby.connectedPlayerCount,
            lobbyPhase: body.lobbyPhase ?? lobby.phase,
          })
          return
        }
        if (!res.ok) {
          throw new Error(body.error ?? "Failed to close lobby")
        }
        setConfirmClose(null)
        await loadDashboard()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to close lobby")
      } finally {
        setClosingLobbyId(null)
      }
    },
    [loadDashboard],
  )

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-slate-100" data-testid="lobby-dashboard">
      {confirmClose ? (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 px-6 text-center backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm close lobby"
          data-testid="close-lobby-confirm"
        >
          <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-slate-950 p-6 shadow-2xl shadow-red-950/40">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">Confirm Close</p>
            <h2 className="mt-3 text-2xl font-black text-white">Close occupied lobby?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {confirmClose.playerCount} player{confirmClose.playerCount === 1 ? "" : "s"} in{" "}
              {PHASE_LABELS[confirmClose.lobbyPhase]} will receive the admin close countdown.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-slate-100 transition hover:bg-white/10"
                type="button"
                onClick={() => setConfirmClose(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                disabled={closingLobbyId === confirmClose.lobby.lobbyId}
                onClick={() => void requestCloseLobby(confirmClose.lobby, true)}
              >
                {closingLobbyId === confirmClose.lobby.lobbyId ? "Closing..." : "Close Lobby"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">Wizard Wars Admin</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Lobby Dashboard</h1>
            <p className="mt-2 font-mono text-xs text-slate-500">
              Refreshed {data ? formatTime(data.generatedAt) : "..."}
            </p>
          </div>
          <button
            className="w-fit rounded-xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200"
            type="button"
            onClick={() => void loadDashboard()}
          >
            Refresh
          </button>
        </header>

        {error ? (
          <div
            className="rounded-2xl border border-red-500/35 bg-red-950/35 px-4 py-3 text-sm text-red-100"
            data-testid="lobby-dashboard-error"
          >
            {error}
          </div>
        ) : null}
        {data && !data.runtimeAvailable ? (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Matchmaker runtime unavailable.
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-3">
          <Metric label="Lobbies" value={String(totals.lobbies)} />
          <Metric label="Connected Players" value={String(totals.players)} />
          <Metric label="Total Bandwidth" value={formatBytes(totals.bandwidth)} />
        </section>

        {loading ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-36 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
            ))}
          </div>
        ) : lobbies.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-10 text-center">
            <p className="text-lg font-bold text-white">No active lobbies</p>
          </div>
        ) : (
          <section className="grid gap-4">
            {lobbies.map((lobby) => (
              <LobbyCard
                key={lobby.lobbyId}
                lobby={lobby}
                closing={closingLobbyId === lobby.lobbyId}
                onClose={(target) => void requestCloseLobby(target)}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  )
}

/**
 * Compact dashboard metric tile.
 *
 * @param props - Metric label and value.
 * @returns Metric tile.
 */
function Metric(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{props.label}</p>
      <p className="mt-2 font-mono text-2xl font-black text-white">{props.value}</p>
    </div>
  )
}

/**
 * Renders one lobby row with roster and close controls.
 *
 * @param props - Lobby row props.
 * @returns Lobby dashboard card.
 */
function LobbyCard(props: {
  readonly lobby: DevLobbyDashboardLobby
  readonly closing: boolean
  readonly onClose: (lobby: DevLobbyDashboardLobby) => void
}) {
  const { lobby } = props
  return (
    <article
      className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"
      data-testid="dashboard-lobby-card"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-lg font-black text-white">
              {lobby.hostName ? `${lobby.hostName}'s Lobby` : "Open Lobby"}
            </h2>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${phaseBadgeClass(lobby.phase)}`}>
              {PHASE_LABELS[lobby.phase]}
            </span>
            {lobby.locked ? (
              <span className="rounded-full border border-red-300/30 bg-red-500/15 px-3 py-1 text-xs font-bold text-red-100">
                Locked
              </span>
            ) : null}
            {!lobby.snapshotAvailable ? (
              <span className="rounded-full border border-amber-300/30 bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-100">
                Metadata Only
              </span>
            ) : null}
          </div>
          <p className="mt-2 font-mono text-xs text-slate-500">{lobby.lobbyId}</p>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-4 xl:min-w-[620px]">
          <Stat label="Players" value={`${lobby.connectedPlayerCount}/${lobby.maxPlayers}`} />
          <Stat label="Roster" value={String(lobby.rosterPlayerCount)} />
          <Stat label="Uptime" value={formatUptime(lobby.uptimeMs)} />
          <Stat label="Bandwidth" value={formatBytes(lobby.bandwidth.totalBytes)} />
        </div>

        <button
          className="rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          disabled={props.closing}
          onClick={() => props.onClose(lobby)}
        >
          {props.closing ? "Closing..." : "Close Lobby"}
        </button>
      </div>

      {lobby.players.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="border-b border-white/10 py-2 pr-3">Player</th>
                <th className="border-b border-white/10 px-3 py-2">Hero</th>
                <th className="border-b border-white/10 px-3 py-2">Connection</th>
                <th className="border-b border-white/10 px-3 py-2">Status</th>
                <th className="border-b border-white/10 px-3 py-2">Scene</th>
                <th className="border-b border-white/10 py-2 pl-3">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {lobby.players.map((player) => (
                <tr key={player.playerId} className="border-b border-white/5 text-slate-200 last:border-0">
                  <td className="py-2 pr-3 font-semibold text-white">
                    {player.username}
                    {player.isHost ? <span className="ml-2 text-xs text-cyan-300">Host</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-300">{player.heroId}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        player.connectionStatus === "connected"
                          ? "text-emerald-200"
                          : "text-amber-200"
                      }
                    >
                      {player.connectionStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2">{PLAY_STATUS_LABELS[player.playStatus]}</td>
                  <td className="px-3 py-2">{player.clientSceneReady ? "Ready" : "Pending"}</td>
                  <td className="py-2 pl-3 font-mono text-xs text-slate-400">{formatTime(player.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
          No roster snapshot.
        </p>
      )}
    </article>
  )
}

/**
 * Small stat pill inside a lobby card.
 *
 * @param props - Stat label and value.
 * @returns Stat pill.
 */
function Stat(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{props.label}</p>
      <p className="mt-1 font-mono font-bold text-white">{props.value}</p>
    </div>
  )
}
