/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { mountGame } from "@/game/main"
import { WW_ABILITY_SLOTS_REGISTRY_KEY } from "@/game/constants"
import { DEFAULT_ABILITY_SLOT_0_ID } from "@/shared/balance-config/abilities"
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
  mountedGame: {
    registry: {
      set: vi.fn(),
      get: vi.fn(() => null),
      events: {
        on: vi.fn(),
        off: vi.fn(),
      },
    },
  },
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
    game: testState.mountedGame,
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

  it("counts owner ACKs as authoritative traffic while only ACK cursors arrive", async () => {
    render(<LobbyGameHost lobbyId="room-1" />)
    await waitFor(() => expect(mountGame).toHaveBeenCalled())
    await waitFor(() => expect(testState.handlers.size).toBeGreaterThan(0))

    try {
      vi.useFakeTimers()
      vi.setSystemTime(1_000)

      act(() => {
        emit({
          type: WsEvent.PlayerBatchUpdate,
          payload: {
            deltas: [],
            removedIds: [],
            seq: 1,
            serverTimeMs: 1_000,
          },
        })
      })

      const mountOptions = vi.mocked(mountGame).mock.calls[0]![0]
      act(() => {
        vi.setSystemTime(6_100)
        mountOptions.onActiveLocalInput?.()
      })
      expect(screen.getByTestId("performance-issue-lost_connection")).toBeTruthy()

      act(() => {
        emit({
          type: WsEvent.PlayerOwnerAck,
          payload: {
            id: 1,
            playerId: "player-1",
            x: 10,
            y: 20,
            vx: 0,
            vy: 0,
            lastProcessedInputSeq: 0,
            serverTimeMs: 6_100,
            replayContext: {
              moveState: "idle",
              terrainState: "land",
              castingAbilityId: null,
              jumpZ: 0,
              jumpStartedInLava: false,
              isSwinging: false,
              hasSwiftBoots: false,
            },
          },
        })
      })
      expect(screen.queryByTestId("performance-issue-lost_connection")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("mounts Phaser with the default fireball slot before shop state arrives", async () => {
    render(<LobbyGameHost lobbyId="room-1" />)
    await waitFor(() => expect(mountGame).toHaveBeenCalled())

    const mountOptions = vi.mocked(mountGame).mock.calls[0]![0]
    expect(mountOptions.abilitySlots).toEqual([
      DEFAULT_ABILITY_SLOT_0_ID,
      null,
      null,
      null,
      null,
    ])
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

  it("mirrors shop ability slots into the Phaser registry without remounting", async () => {
    render(<LobbyGameHost lobbyId="room-1" />)
    await waitFor(() => expect(mountGame).toHaveBeenCalled())
    await waitFor(() => expect(testState.handlers.size).toBeGreaterThan(0))

    act(() => {
      emit({
        type: WsEvent.ShopState,
        payload: {
          gold: 10,
          items: [{ itemId: "lightning_bolt" }],
          augmentItemIds: [],
          abilitySlots: ["fireball", null, "lightning_bolt", null, null],
          quickItemSlots: [
            { itemId: null, charges: 0 },
            { itemId: null, charges: 0 },
            { itemId: null, charges: 0 },
            { itemId: null, charges: 0 },
          ],
        },
      })
    })

    await waitFor(() => {
      expect(testState.mountedGame.registry.set).toHaveBeenCalledWith(
        WW_ABILITY_SLOTS_REGISTRY_KEY,
        ["fireball", null, "lightning_bolt", null, null],
      )
    })
    expect(mountGame).toHaveBeenCalledTimes(1)
  })
})
