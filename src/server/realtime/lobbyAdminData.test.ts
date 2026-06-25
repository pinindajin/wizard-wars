import { describe, expect, it, vi } from "vitest"

import {
  buildDashboardLobby,
  buildDashboardResponse,
  buildRealtimeLobbyList,
  degradedDashboardLobby,
  listingCreatedAt,
  queryDashboardResponse,
  queryRealtimeLobbyList,
} from "./lobbyAdminData"

describe("realtime lobby admin data helpers", () => {
  it("normalizes listing timestamps", () => {
    expect(listingCreatedAt(new Date("2026-06-25T00:00:00.000Z"))).toBe("2026-06-25T00:00:00.000Z")
    expect(listingCreatedAt("2026-06-24T00:00:00.000Z")).toBe("2026-06-24T00:00:00.000Z")
    expect(listingCreatedAt(undefined, new Date("2026-06-23T00:00:00.000Z"))).toBe("2026-06-23T00:00:00.000Z")
  })

  it("builds lobby list rows with metadata and fallback values", () => {
    const result = buildRealtimeLobbyList(
      [
        {
          roomId: "r1",
          locked: false,
          clients: 3,
          maxClients: 10,
          createdAt: "2026-06-25T00:00:00.000Z",
          metadata: {
            lobbyPhase: "COUNTDOWN",
            hostName: "Host",
            hostPlayerId: "h1",
            playerCount: 2,
            maxPlayers: 8,
          },
        },
        { roomId: "r2", locked: false, clients: 1, maxClients: 4, metadata: { lobbyPhase: "BAD" } },
        { roomId: "locked", locked: true, clients: 1, metadata: {} },
      ],
      new Date("2026-06-24T00:00:00.000Z"),
    )

    expect(result).toEqual({
      lobbies: [
        {
          lobbyId: "r1",
          lobbyPhase: "COUNTDOWN",
          hostName: "Host",
          hostPlayerId: "h1",
          playerCount: 2,
          maxPlayers: 8,
          createdAt: "2026-06-25T00:00:00.000Z",
        },
        {
          lobbyId: "r2",
          lobbyPhase: "LOBBY",
          hostName: "",
          hostPlayerId: "",
          playerCount: 1,
          maxPlayers: 4,
          createdAt: "2026-06-24T00:00:00.000Z",
        },
      ],
    })
  })

  it("builds degraded dashboard rows from listing metadata", () => {
    expect(
      degradedDashboardLobby(
        {
          roomId: "r1",
          locked: true,
          clients: 2,
          maxClients: 12,
          createdAt: "bad-date",
          metadata: {
            lobbyPhase: "IN_PROGRESS",
            hostName: "Host",
            hostPlayerId: "h1",
          },
        },
        Date.parse("2026-06-25T00:00:00.000Z"),
        "local_room_missing",
      ),
    ).toMatchObject({
      snapshotAvailable: false,
      snapshotError: "local_room_missing",
      locked: true,
      lobbyId: "r1",
      phase: "IN_PROGRESS",
      uptimeMs: 0,
      connectedPlayerCount: 2,
      maxPlayers: 12,
      hostPlayerId: "h1",
      hostName: "Host",
      players: [],
    })
  })

  it("uses local snapshots and falls back when snapshots are missing or fail", () => {
    const listing = { roomId: "r1", locked: false, clients: 1, metadata: {} }
    const snapshotRoom = {
      getAdminSnapshot: () => ({
        snapshotAvailable: true,
        lobbyId: "r1",
        phase: "LOBBY" as const,
        createdAt: "2026-06-24T00:00:00.000Z",
        uptimeMs: 1,
        connectedPlayerCount: 1,
        rosterPlayerCount: 1,
        maxPlayers: 12,
        hostPlayerId: "h1",
        hostName: "Host",
        bandwidth: { inboundBytes: 1, outboundBytes: 2, totalBytes: 3 },
        players: [],
      }),
    }

    expect(
      buildDashboardLobby({ getLocalRoomById: () => snapshotRoom as never }, listing, Date.now()),
    ).toMatchObject({
      snapshotAvailable: true,
      locked: false,
      bandwidth: { totalBytes: 3 },
    })
    expect(
      buildDashboardLobby({ getLocalRoomById: () => undefined as never }, listing, Date.now()),
    ).toMatchObject({
      snapshotAvailable: false,
      snapshotError: "local_room_missing",
    })
    expect(
      buildDashboardLobby(
        {
          getLocalRoomById: () => ({
            getAdminSnapshot: () => {
              throw new Error("boom")
            },
          }) as never,
        },
        listing,
        Date.now(),
      ),
    ).toMatchObject({
      snapshotAvailable: false,
      snapshotError: "snapshot_failed",
    })
  })

  it("queries matchmaker for dashboard and lobby-list responses", async () => {
    const matchMaker = {
      query: vi.fn().mockResolvedValue([{ roomId: "r1", locked: false, clients: 1, metadata: {} }]),
      getLocalRoomById: vi.fn().mockReturnValue(undefined),
    }

    await expect(
      queryDashboardResponse(matchMaker, new Date("2026-06-25T00:00:00.000Z")),
    ).resolves.toMatchObject({
      generatedAt: "2026-06-25T00:00:00.000Z",
      runtimeAvailable: true,
      viewer: { isAdmin: true },
      lobbies: [{ lobbyId: "r1", snapshotError: "local_room_missing" }],
    })
    await expect(
      queryRealtimeLobbyList(matchMaker, new Date("2026-06-25T00:00:00.000Z")),
    ).resolves.toEqual({
      lobbies: [
        {
          lobbyId: "r1",
          lobbyPhase: "LOBBY",
          hostName: "",
          hostPlayerId: "",
          playerCount: 1,
          maxPlayers: 12,
          createdAt: "2026-06-25T00:00:00.000Z",
        },
      ],
    })
  })

  it("builds dashboard response envelopes", () => {
    expect(buildDashboardResponse(false, [], "2026-06-25T00:00:00.000Z")).toEqual({
      generatedAt: "2026-06-25T00:00:00.000Z",
      runtimeAvailable: false,
      viewer: { isAdmin: true },
      lobbies: [],
    })
  })
})
