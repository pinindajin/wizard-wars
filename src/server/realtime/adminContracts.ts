import type { AdminLobbySnapshot } from "@/server/colyseus/rooms/GameLobbyRoom"
import type { LobbyPhase } from "@/shared/types"

export type LobbyListEntry = {
  readonly lobbyId: string
  readonly lobbyPhase: "LOBBY" | "WAITING_FOR_CLIENTS" | "COUNTDOWN" | "IN_PROGRESS" | "SCOREBOARD"
  readonly hostName: string
  readonly hostPlayerId: string
  readonly playerCount: number
  readonly maxPlayers: number
  readonly createdAt: string
}

export type LobbyListResponse = {
  readonly lobbies: readonly LobbyListEntry[]
  readonly viewer: {
    readonly isAdmin: boolean
  }
}

export type RealtimeLobbyListResponse = {
  readonly lobbies: readonly LobbyListEntry[]
}

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

export type InternalCloseLobbyRequest = {
  readonly adminUserId: string
  readonly adminUsername: string
  readonly confirmed: boolean
}

export type ErrorResponse = {
  readonly error: string
}
