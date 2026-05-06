import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import type { matchMaker as colyseusMatchMaker } from "@colyseus/core"

import { AUTH_COOKIE_NAME, createClearAuthCookie } from "@/server/auth"
import { verifyAdminToken } from "@/server/admin/verifyAdminToken"
import { prisma } from "@/server/db"
import type { AdminLobbySnapshot } from "@/server/colyseus/rooms/GameLobbyRoom"
import type { LobbyPhase } from "@/shared/types"

export type DevLobbyDashboardBandwidth = {
  readonly inboundBytes: number
  readonly outboundBytes: number
  readonly totalBytes: number
}

export type DevLobbyDashboardLobby = {
  readonly snapshotAvailable: boolean
  readonly snapshotError?: "local_room_missing" | "snapshot_failed"
  readonly locked: boolean
  readonly lobbyId: string
  readonly phase: LobbyPhase
  readonly createdAt: string
  readonly uptimeMs: number
  readonly connectedPlayerCount: number
  readonly rosterPlayerCount: number
  readonly maxPlayers: number
  readonly hostPlayerId: string | null
  readonly hostName: string
  readonly bandwidth: DevLobbyDashboardBandwidth
  readonly players: AdminLobbySnapshot["players"]
}

export type DevLobbyDashboardResponse = {
  readonly generatedAt: string
  readonly runtimeAvailable: boolean
  readonly viewer: {
    readonly isAdmin: true
  }
  readonly lobbies: readonly DevLobbyDashboardLobby[]
}

type WizardWarsMatchMaker = Pick<typeof colyseusMatchMaker, "query" | "getLocalRoomById">

type RoomListing = {
  readonly roomId: string
  readonly locked?: boolean
  readonly clients?: number
  readonly maxClients?: number
  readonly createdAt?: string | Date
  readonly metadata?: Record<string, unknown>
}

type SnapshotCapableRoom = {
  getAdminSnapshot: () => AdminLobbySnapshot
}

/**
 * Reads the Colyseus matchmaker exported by the custom server bootstrap.
 *
 * @returns Matchmaker subset used by the dashboard, or undefined when unavailable.
 */
function getMatchMaker(): WizardWarsMatchMaker | undefined {
  return (
    globalThis as unknown as {
      __wizardWarsMatchMaker?: WizardWarsMatchMaker
    }
  ).__wizardWarsMatchMaker
}

/**
 * Checks whether a local room instance exposes the admin snapshot API.
 *
 * @param room - Candidate local room instance.
 * @returns True when the room can provide a full dashboard snapshot.
 */
function hasAdminSnapshot(room: unknown): room is SnapshotCapableRoom {
  return (
    typeof room === "object" &&
    room !== null &&
    "getAdminSnapshot" in room &&
    typeof (room as { readonly getAdminSnapshot?: unknown }).getAdminSnapshot === "function"
  )
}

/**
 * Coerces listing metadata into a known lobby phase.
 *
 * @param value - Raw metadata value.
 * @returns Valid lobby phase, defaulting to `LOBBY`.
 */
function coerceLobbyPhase(value: unknown): LobbyPhase {
  if (
    value === "LOBBY" ||
    value === "WAITING_FOR_CLIENTS" ||
    value === "COUNTDOWN" ||
    value === "IN_PROGRESS" ||
    value === "SCOREBOARD"
  ) {
    return value
  }
  return "LOBBY"
}

/**
 * Converts room listing timestamps into ISO strings.
 *
 * @param value - Listing `createdAt` value.
 * @returns ISO timestamp.
 */
function listingCreatedAt(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string") return new Date(value).toISOString()
  return new Date().toISOString()
}

/**
 * Builds a degraded row when only matchmaker metadata is available.
 *
 * @param listing - Matchmaker room listing.
 * @param generatedAtMs - Current wall-clock timestamp.
 * @param error - Why the full snapshot is unavailable.
 * @returns Dashboard lobby row with empty roster and zero bandwidth.
 */
function degradedLobby(
  listing: RoomListing,
  generatedAtMs: number,
  error: DevLobbyDashboardLobby["snapshotError"],
): DevLobbyDashboardLobby {
  const metadata = listing.metadata ?? {}
  const createdAt = listingCreatedAt(listing.createdAt)
  const createdAtMs = Date.parse(createdAt)
  const connectedPlayerCount =
    typeof metadata.playerCount === "number" ? metadata.playerCount : listing.clients ?? 0
  const maxPlayers =
    typeof metadata.maxPlayers === "number" ? metadata.maxPlayers : listing.maxClients ?? 12

  return {
    snapshotAvailable: false,
    snapshotError: error,
    locked: Boolean(listing.locked),
    lobbyId: listing.roomId,
    phase: coerceLobbyPhase(metadata.lobbyPhase),
    createdAt,
    uptimeMs: Number.isFinite(createdAtMs) ? Math.max(0, generatedAtMs - createdAtMs) : 0,
    connectedPlayerCount,
    rosterPlayerCount: connectedPlayerCount,
    maxPlayers,
    hostPlayerId: typeof metadata.hostPlayerId === "string" ? metadata.hostPlayerId : null,
    hostName: typeof metadata.hostName === "string" ? metadata.hostName : "",
    bandwidth: { inboundBytes: 0, outboundBytes: 0, totalBytes: 0 },
    players: [],
  }
}

/**
 * Converts a matchmaker listing into a full or degraded dashboard row.
 *
 * @param matchMaker - Colyseus matchmaker.
 * @param listing - Room listing returned by `query`.
 * @param generatedAtMs - Current wall-clock timestamp.
 * @returns Dashboard lobby row.
 */
function dashboardLobby(
  matchMaker: WizardWarsMatchMaker,
  listing: RoomListing,
  generatedAtMs: number,
): DevLobbyDashboardLobby {
  const localRoom = matchMaker.getLocalRoomById(listing.roomId)
  if (!hasAdminSnapshot(localRoom)) {
    return degradedLobby(listing, generatedAtMs, "local_room_missing")
  }

  try {
    const snapshot = localRoom.getAdminSnapshot()
    return { ...snapshot, locked: Boolean(listing.locked) }
  } catch {
    return degradedLobby(listing, generatedAtMs, "snapshot_failed")
  }
}

/**
 * Builds the common dashboard response envelope.
 *
 * @param runtimeAvailable - Whether the Colyseus runtime answered successfully.
 * @param lobbies - Lobby rows for the dashboard.
 * @returns JSON response body.
 */
function dashboardResponse(
  runtimeAvailable: boolean,
  lobbies: readonly DevLobbyDashboardLobby[],
): DevLobbyDashboardResponse {
  return {
    generatedAt: new Date().toISOString(),
    runtimeAvailable,
    viewer: { isAdmin: true },
    lobbies,
  }
}

/**
 * GET /api/dev/lobby-dashboard - Admin-only live lobby dashboard data.
 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const admin = await verifyAdminToken(prisma, cookieStore.get(AUTH_COOKIE_NAME)?.value)

  if (!admin.ok) {
    const status = admin.reason === "forbidden" ? 403 : 401
    const response = NextResponse.json(
      { error: status === 403 ? "Forbidden" : "Unauthorized" },
      { status },
    )
    if (admin.reason === "stale_user") {
      response.headers.append("set-cookie", createClearAuthCookie())
    }
    return response
  }

  const matchMaker = getMatchMaker()
  if (!matchMaker) {
    return NextResponse.json(dashboardResponse(false, []))
  }

  try {
    const generatedAtMs = Date.now()
    const rooms = (await matchMaker.query({ name: "game_lobby" })) as RoomListing[]
    const lobbies = rooms.map((room) => dashboardLobby(matchMaker, room, generatedAtMs))
    return NextResponse.json(dashboardResponse(true, lobbies))
  } catch {
    return NextResponse.json(dashboardResponse(false, []))
  }
}
