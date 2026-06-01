/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WsEvent } from "@/shared/events"
import type {
  AnyWsMessage,
  MessageHandler,
  ServerPerformanceStatusPayload,
} from "@/shared/types"

import LobbyGameHost from "./LobbyGameHost"

const testState = vi.hoisted(() => ({
  lobbyConnection: null as unknown,
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
  handlers: new Set<MessageHandler>(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => testState.router,
}))

vi.mock("@/lib/fetch-ws-auth-token", () => ({
  fetchWsAuthToken: vi.fn(async () => "token"),
}))

vi.mock("@/lib/trpc", () => ({
  createTrpcClient: () => ({
    user: {
      me: {
        query: vi.fn(async () => ({ user: null })),
      },
    },
  }),
}))

vi.mock("@/game/main", () => ({
  mountGame: vi.fn(() => ({
    destroy: vi.fn(),
    game: null,
  })),
}))

vi.mock("../LobbyConnectionProvider", () => ({
  useLobbyConnection: () => testState.lobbyConnection,
}))

function degradedStatus(): ServerPerformanceStatusPayload {
  return {
    serverTimeMs: 1_000,
    degraded: true,
    reasons: ["event_loop_lag"],
    metrics: {
      windowMs: 1_000,
      droppedDebtMs: 0,
      catchUpCallbacks: 0,
      inputQueueDrops: 0,
      simDurationMs: 1,
      broadcastDurationMs: 1,
      eventLoopLagMs: 40,
      processCpuPercent: 10,
      heapUsedBytes: 1,
      rssBytes: 2,
      activeRooms: 1,
      connectedClients: 1,
    },
  }
}

function emit(message: AnyWsMessage): void {
  for (const handler of testState.handlers) handler(message)
}

describe("LobbyGameHost performance indicators", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.handlers.clear()
    const connection = {
      onConnectionHealthChange: vi.fn(() => () => {}),
      onMessage: vi.fn((handler: MessageHandler) => {
        testState.handlers.add(handler)
        return () => {
          testState.handlers.delete(handler)
        }
      }),
      sendLobbyEndGame: vi.fn(),
      sendLobbyReturnToLobby: vi.fn(),
    }
    testState.lobbyConnection = {
      connection,
      lobbyState: {
        phase: "IN_PROGRESS",
        hostPlayerId: "player-1",
        players: [],
      },
      adminClosing: null,
      localPlayerId: "player-1",
      error: null,
      isConnected: true,
      onMessage: vi.fn(),
    }
  })

  it("clears degraded server status when the match leaves active play", async () => {
    render(<LobbyGameHost lobbyId="room-1" />)
    await waitFor(() => expect(testState.handlers.size).toBeGreaterThan(0))

    act(() => {
      emit({
        type: WsEvent.ServerPerformanceStatus,
        payload: degradedStatus(),
      })
    })
    expect(screen.getByTestId("performance-issue-server_cpu")).toBeTruthy()

    act(() => {
      emit({
        type: WsEvent.LobbyState,
        payload: {
          phase: "SCOREBOARD",
          hostPlayerId: "player-1",
          players: [],
        },
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId("performance-issue-server_cpu")).toBeNull()
    })
  })
})
