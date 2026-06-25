import type { matchMaker as colyseusMatchMaker } from "@colyseus/core"

import type { AdminLobbySnapshot } from "@/server/colyseus/rooms/GameLobbyRoom"
import type {
  DevLobbyDashboardLobby,
  DevLobbyDashboardResponse,
  LobbyListEntry,
  RealtimeLobbyListResponse,
} from "./adminContracts"
import type { LobbyPhase } from "@/shared/types"

export type RealtimeMatchMaker = Pick<
  typeof colyseusMatchMaker,
  "query" | "getRoomById" | "remoteRoomCall" | "getLocalRoomById"
>

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
 * Coerces listing metadata into a known lobby phase.
 *
 * @param value - Raw metadata value.
 * @returns Valid lobby phase, defaulting to `LOBBY`.
 */
export function coerceLobbyPhase(value: unknown): LobbyPhase {
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
 * @param now - Fallback timestamp.
 * @returns ISO timestamp.
 */
export function listingCreatedAt(value: string | Date | undefined, now = new Date()): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string") {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }
  return now.toISOString()
}

/**
 * Converts Colyseus room listings into the public lobby-list response shape.
 *
 * @param rooms - Room listings from Colyseus matchMaker.
 * @param now - Fallback timestamp.
 * @returns Realtime lobby list response.
 */
export function buildRealtimeLobbyList(
  rooms: readonly RoomListing[],
  now = new Date(),
): RealtimeLobbyListResponse {
  const lobbies: LobbyListEntry[] = rooms
    .filter((r) => !r.locked)
    .map((r) => ({
      lobbyId: r.roomId,
      lobbyPhase: coerceLobbyPhase(r.metadata?.lobbyPhase) as LobbyListEntry["lobbyPhase"],
      hostName: typeof r.metadata?.hostName === "string" ? r.metadata.hostName : "",
      hostPlayerId: typeof r.metadata?.hostPlayerId === "string" ? r.metadata.hostPlayerId : "",
      playerCount: typeof r.metadata?.playerCount === "number" ? r.metadata.playerCount : r.clients ?? 0,
      maxPlayers: typeof r.metadata?.maxPlayers === "number" ? r.metadata.maxPlayers : r.maxClients ?? 12,
      createdAt: listingCreatedAt(r.createdAt, now),
    }))

  return { lobbies }
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
 * Builds a degraded row when only matchmaker metadata is available.
 *
 * @param listing - Matchmaker room listing.
 * @param generatedAtMs - Current wall-clock timestamp.
 * @param error - Why the full snapshot is unavailable.
 * @returns Dashboard lobby row with empty roster and zero bandwidth.
 */
export function degradedDashboardLobby(
  listing: RoomListing,
  generatedAtMs: number,
  error: DevLobbyDashboardLobby["snapshotError"],
): DevLobbyDashboardLobby {
  const metadata = listing.metadata ?? {}
  const createdAt = listingCreatedAt(listing.createdAt, new Date(generatedAtMs))
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
export function buildDashboardLobby(
  matchMaker: Pick<RealtimeMatchMaker, "getLocalRoomById">,
  listing: RoomListing,
  generatedAtMs: number,
): DevLobbyDashboardLobby {
  const localRoom = matchMaker.getLocalRoomById(listing.roomId)
  if (!hasAdminSnapshot(localRoom)) {
    return degradedDashboardLobby(listing, generatedAtMs, "local_room_missing")
  }

  try {
    const snapshot = localRoom.getAdminSnapshot()
    return { ...snapshot, locked: Boolean(listing.locked) }
  } catch {
    return degradedDashboardLobby(listing, generatedAtMs, "snapshot_failed")
  }
}

/**
 * Builds the common dashboard response envelope.
 *
 * @param runtimeAvailable - Whether the Colyseus runtime answered successfully.
 * @param lobbies - Lobby rows for the dashboard.
 * @param generatedAt - Optional fixed generation timestamp.
 * @returns JSON response body.
 */
export function buildDashboardResponse(
  runtimeAvailable: boolean,
  lobbies: readonly DevLobbyDashboardLobby[],
  generatedAt = new Date().toISOString(),
): DevLobbyDashboardResponse {
  return {
    generatedAt,
    runtimeAvailable,
    viewer: { isAdmin: true },
    lobbies,
  }
}

/**
 * Reads matchmaker room listings and converts them into a dashboard response.
 *
 * @param matchMaker - Colyseus matchmaker.
 * @param now - Timestamp provider.
 * @returns Dashboard response.
 */
export async function queryDashboardResponse(
  matchMaker: Pick<RealtimeMatchMaker, "query" | "getLocalRoomById">,
  now = new Date(),
): Promise<DevLobbyDashboardResponse> {
  const generatedAtMs = now.getTime()
  const rooms = (await matchMaker.query({ name: "game_lobby" })) as RoomListing[]
  const lobbies = rooms.map((room) => buildDashboardLobby(matchMaker, room, generatedAtMs))
  return buildDashboardResponse(true, lobbies, now.toISOString())
}

/**
 * Reads matchmaker room listings and converts them into the lobby-list response.
 *
 * @param matchMaker - Colyseus matchmaker.
 * @param now - Timestamp provider.
 * @returns Realtime lobby list response.
 */
export async function queryRealtimeLobbyList(
  matchMaker: Pick<RealtimeMatchMaker, "query">,
  now = new Date(),
): Promise<RealtimeLobbyListResponse> {
  const rooms = (await matchMaker.query({ name: "game_lobby" })) as RoomListing[]
  return buildRealtimeLobbyList(rooms, now)
}
