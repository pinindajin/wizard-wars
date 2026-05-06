"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Client } from "@colyseus/sdk"

import {
  LobbyEmptyState,
  LobbyHeader,
  LobbyPanel,
  LobbyShell,
  LobbyStatusPill,
} from "@/components/lobby/LobbyChrome"
import { fetchWsAuthToken } from "@/lib/fetch-ws-auth-token"
import { getColyseusUrl } from "@/lib/endpoints"
import type { LobbyListEntry } from "@/app/api/lobbies/route"
import type { LobbyListResponse } from "@/app/api/lobbies/route"
import { btnGhost, btnPrimary, cardRow, metaText } from "@/lib/ui/lobbyStyles"

const POLL_INTERVAL_MS = 5000

/** Phase labels shown in the UI for each LobbyPhase value. */
const PHASE_LABELS: Record<LobbyListEntry["lobbyPhase"], string> = {
  LOBBY: "In Lobby",
  WAITING_FOR_CLIENTS: "Loading…",
  COUNTDOWN: "Starting…",
  IN_PROGRESS: "In Progress",
  SCOREBOARD: "Scoreboard",
}

/** Phase badge tone keys mapped to the shared status-pill component. */
const PHASE_TONES: Record<
  LobbyListEntry["lobbyPhase"],
  "neutral" | "success" | "warning" | "danger"
> = {
  LOBBY: "success",
  WAITING_FOR_CLIENTS: "warning",
  COUNTDOWN: "warning",
  IN_PROGRESS: "danger",
  SCOREBOARD: "neutral",
}

/**
 * Fetches the list of available game lobbies from the API.
 *
 * @returns Array of LobbyListEntry objects.
 */
async function fetchLobbies(): Promise<LobbyListResponse> {
  try {
    const res = await fetch("/api/lobbies", { credentials: "include" })
    if (!res.ok) return { lobbies: [], viewer: { isAdmin: false } }
    return (await res.json()) as LobbyListResponse
  } catch {
    return { lobbies: [], viewer: { isAdmin: false } }
  }
}

/**
 * Formats the lobby subtitle shown under the room title.
 *
 * @param lobby - The lobby entry being rendered.
 * @returns Concise scan-friendly lobby metadata.
 */
function getLobbyMeta(lobby: LobbyListEntry): string {
  return `${lobby.playerCount}/${lobby.maxPlayers} players connected`
}

/**
 * Server browser client component.
 * Polls `/api/lobbies` every 5 seconds and shows the live lobby list.
 * Allows creating a new lobby or joining an existing one.
 */
export default function ServerBrowser() {
  const router = useRouter()
  const [lobbies, setLobbies] = useState<LobbyListEntry[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [closingLobbyId, setClosingLobbyId] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState<{
    lobby: LobbyListEntry
    playerCount: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  /** Loads the current lobby list and updates state. */
  const loadLobbies = useCallback(async () => {
    const data = await fetchLobbies()
    setLobbies([...data.lobbies])
    setIsAdmin(data.viewer.isAdmin)
    setLoading(false)
  }, [])

  // Initial load + polling
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLobbies()
    pollRef.current = setInterval(() => void loadLobbies(), POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current)
    }
  }, [loadLobbies])

  /**
   * Creates a new `game_lobby` room via the Colyseus matchmaker,
   * then navigates to `/lobby/[id]`.
   *
   * `create()` joins the creator as a client; we leave before navigation so the
   * lobby page’s `joinById` is not rejected as a duplicate session for the same JWT.
   */
  const createLobby = useCallback(async () => {
    setCreating(true)
    setError(null)
    try {
      const token = await fetchWsAuthToken()
      if (!token) throw new Error("Not authenticated")
      const client = new Client(getColyseusUrl())
      const room = await client.create<unknown>("game_lobby", { token })
      // Install a wildcard handler so the initial `lobby_state` / `player_join`
      // / `lobby_chat_history` broadcasts the server fires inside `onJoin`
      // don't trip Colyseus SDK `"onMessage not registered"` warnings during
      // the brief window this temp room exists. Real handling is done by the
      // new `GameConnection` that the lobby route opens after `leave()`.
      room.onMessage("*", () => {})
      const roomId = room.roomId
      // Release create-time seat before the lobby route opens its own connection.
      await room.leave()
      router.push(`/lobby/${roomId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lobby")
      setCreating(false)
    }
  }, [router])

  /**
   * Joins an existing lobby and navigates to `/lobby/[id]`.
   *
   * @param lobbyId - The Colyseus room ID to join.
   */
  const joinLobby = useCallback(
    (lobbyId: string) => {
      router.push(`/lobby/${lobbyId}`)
    },
    [router],
  )

  const requestCloseLobby = useCallback(
    async (lobby: LobbyListEntry, confirmed = false) => {
      if (!confirmed && lobby.playerCount > 0) {
        setConfirmClose({ lobby, playerCount: lobby.playerCount })
        return
      }

      setClosingLobbyId(lobby.lobbyId)
      setError(null)
      try {
        const res = await fetch(`/api/lobbies/${encodeURIComponent(lobby.lobbyId)}/close`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmed }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          readonly error?: string
          readonly playerCount?: number
        }
        if (res.status === 409 && body.error === "confirmation_required") {
          setConfirmClose({
            lobby,
            playerCount: typeof body.playerCount === "number" ? body.playerCount : lobby.playerCount,
          })
          return
        }
        if (!res.ok) {
          throw new Error(body.error ?? "Failed to close lobby")
        }
        setConfirmClose(null)
        await loadLobbies()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to close lobby")
      } finally {
        setClosingLobbyId(null)
      }
    },
    [loadLobbies],
  )

  /**
   * Navigates back to the home / chat page.
   */
  const goHome = useCallback(() => {
    router.push("/home")
  }, [router])

  return (
    <LobbyShell>
      <LobbyHeader
        eyebrow="Wizard Wars"
        title="Server Browser"
        subtitle="Browse open rooms, watch their current phase, and host a new lobby when you want to bring players together."
        aside={
          <>
            <button className={btnGhost} onClick={goHome} type="button">
              Back to Chat
            </button>
            <button
              className={btnPrimary}
              onClick={() => void createLobby()}
              disabled={creating}
              type="button"
            >
              {creating ? "Creating..." : "Create Lobby"}
            </button>
          </>
        }
      />

      <LobbyPanel
        eyebrow="Open Games"
        title="Available Lobbies"
        subtitle="Join a room already filling up or create a fresh lobby and invite others in."
        aside={
          <LobbyStatusPill tone="accent">
            {loading
              ? "Refreshing"
              : `${lobbies.length} lobb${lobbies.length === 1 ? "y" : "ies"} visible`}
          </LobbyStatusPill>
        }
      >
        {confirmClose ? (
          <div
            className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 px-6 text-center backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm close lobby"
            data-testid="close-lobby-confirm"
          >
            <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-slate-950 p-6 shadow-2xl shadow-red-950/40">
              <p className={metaText}>Confirm Close</p>
              <h2 className="mt-3 text-2xl font-black text-white">
                Close occupied lobby?
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {confirmClose.playerCount} player{confirmClose.playerCount === 1 ? "" : "s"} will see a
                30 second admin-close countdown before returning to the browser.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <button
                  className={btnGhost}
                  type="button"
                  onClick={() => setConfirmClose(null)}
                >
                  Cancel
                </button>
                <button
                  className={`${btnPrimary} bg-red-600 hover:bg-red-500`}
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

        {error && (
          <div className="mb-4 rounded-2xl border border-red-500/35 bg-red-950/35 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className={`${cardRow} animate-pulse`}>
                <div className="h-4 w-36 rounded bg-white/10" />
                <div className="mt-3 h-3 w-24 rounded bg-white/8" />
              </div>
            ))}
          </div>
        ) : lobbies.length === 0 ? (
          <LobbyEmptyState
            eyebrow="No Open Rooms"
            title="No lobbies found"
            description="Be the first wizard to open a room. Your lobby will appear here for everyone else in the global chat."
            action={
              <button
                className={btnPrimary}
                onClick={() => void createLobby()}
                disabled={creating}
                type="button"
              >
                {creating ? "Creating..." : "Create the First Lobby"}
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {lobbies.map((lobby) => (
              <div
                key={lobby.lobbyId}
                data-testid={`lobby-row-${lobby.lobbyId}`}
                className={`${cardRow} hover:border-white/18 hover:bg-white/5`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="truncate text-base font-semibold text-white">
                        {lobby.hostName ? `${lobby.hostName}'s Lobby` : "Open Lobby"}
                      </p>
                      <LobbyStatusPill tone={PHASE_TONES[lobby.lobbyPhase]}>
                        {PHASE_LABELS[lobby.lobbyPhase]}
                      </LobbyStatusPill>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{getLobbyMeta(lobby)}</p>
                    <p className="mt-3 font-mono text-[11px] text-slate-500">{lobby.lobbyId}</p>
                  </div>

                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                    <div className="rounded-2xl border border-white/8 bg-white/3 px-4 py-2">
                      <p className={metaText}>Lobby Phase</p>
                      <p className="mt-1 text-sm font-medium text-white">
                        {PHASE_LABELS[lobby.lobbyPhase]}
                      </p>
                    </div>
                    <button
                      className={btnPrimary}
                      onClick={() => joinLobby(lobby.lobbyId)}
                      disabled={lobby.lobbyPhase === "IN_PROGRESS"}
                      type="button"
                    >
                      {lobby.lobbyPhase === "IN_PROGRESS" ? "In Progress" : "Join Lobby"}
                    </button>
                    {isAdmin ? (
                      <button
                        className={`${btnGhost} border-red-900/50 text-red-300 hover:bg-red-900/20`}
                        onClick={() => void requestCloseLobby(lobby)}
                        disabled={closingLobbyId === lobby.lobbyId}
                        type="button"
                      >
                        {closingLobbyId === lobby.lobbyId ? "Closing..." : "Close"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </LobbyPanel>
    </LobbyShell>
  )
}
