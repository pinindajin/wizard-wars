import { beforeEach, describe, expect, it, vi } from "vitest"

import { WW_GAME_CONNECTION_REGISTRY_KEY, WW_LOCAL_PLAYER_ID_REGISTRY_KEY } from "../constants"
import { ArenaRuntime } from "./ArenaRuntime"
import { WsEvent } from "@/shared/events"
import type { AnyWsMessage, MessageHandler } from "@/shared/types"

vi.mock("phaser", () => ({
  default: {
    Scenes: {
      Events: {
        SHUTDOWN: "shutdown",
      },
    },
  },
}))

vi.mock("../ecs/systems/PlayerRenderSystem", () => ({
  PlayerRenderSystem: vi.fn().mockImplementation(() => ({
    localPlayerId: null,
    markBatchReceived: vi.fn(),
    onAuthoritativePosition: vi.fn(),
    onRemoteSnapshot: vi.fn(),
    onLocalAck: vi.fn(),
    updateServerTimeOffset: vi.fn(),
    applyFullSync: vi.fn(),
    onPrimaryMeleeSwing: vi.fn(),
    onPlayerDeath: vi.fn(),
    onPlayerRespawn: vi.fn(),
    triggerHitFeedbackFlashForPlayerUserId: vi.fn(),
    getEstimatedServerTimeMs: vi.fn(() => 0),
    update: vi.fn(),
    getLocalPlayerRenderPos: vi.fn(() => null),
    localInputHistory: { append: vi.fn() },
  })),
}))

vi.mock("../ecs/systems/ProjectileRenderSystem", () => ({
  ProjectileRenderSystem: vi.fn().mockImplementation(() => ({
    applyFullSyncFireballs: vi.fn(),
    spawnFireball: vi.fn(),
    applyBatchUpdate: vi.fn(),
    destroyFireball: vi.fn(),
    update: vi.fn(),
  })),
}))

vi.mock("../ecs/systems/LightningBoltRenderSystem", () => ({
  LightningBoltRenderSystem: vi.fn().mockImplementation(() => ({
    spawnBolt: vi.fn(),
    update: vi.fn(),
  })),
}))

vi.mock("../ecs/systems/DamageFloatersSystem", () => ({
  DamageFloatersSystem: vi.fn().mockImplementation(() => ({
    spawn: vi.fn(),
    update: vi.fn(),
  })),
}))

vi.mock("../ecs/systems/DebugOverlaySystem", () => ({
  DebugOverlaySystem: vi.fn().mockImplementation(() => ({
    setEnabled: vi.fn(),
    update: vi.fn(),
  })),
}))

vi.mock("../ecs/systems/NetworkSyncSystem", () => ({
  NetworkSyncSystem: vi.fn().mockImplementation(() => ({
    localPlayerId: null,
    applyFullSync: vi.fn(),
    applyBatchUpdate: vi.fn(),
  })),
}))

vi.mock("../input/KeyboardController", () => ({
  KeyboardController: vi.fn().mockImplementation(() => ({
    enable: vi.fn(),
    collectInput: vi.fn(),
  })),
}))

vi.mock("../input/MouseController", () => ({
  MouseController: vi.fn().mockImplementation(() => ({
    enable: vi.fn(),
    collectInput: vi.fn(),
  })),
}))

vi.mock("../audio/BgmPlayer", () => ({
  BgmPlayer: vi.fn().mockImplementation(() => ({
    startBattleMusic: vi.fn(),
    setMasterBgmVolume: vi.fn(),
  })),
}))

vi.mock("../audio/SoundManager", () => ({
  SoundManager: vi.fn().mockImplementation(() => ({
    play: vi.fn(),
    playRestarting: vi.fn(),
    setMasterSfxVolume: vi.fn(),
  })),
}))

vi.mock("../audio/WalkFootstepController", () => ({
  WalkFootstepController: vi.fn().mockImplementation(() => ({
    tick: vi.fn(),
  })),
}))

vi.mock("../minimap/MinimapController", () => ({
  MinimapController: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
    setCorner: vi.fn(),
    update: vi.fn(),
  })),
}))

vi.mock("../animation/LadyWizardAnimDefs", () => ({
  registerLadyWizardAnims: vi.fn(),
}))

vi.mock("../animation/FireballAnimDefs", () => ({
  registerFireballAnims: vi.fn(),
}))

function makeConnection() {
  const handlers = new Set<MessageHandler>()
  const unsubscribeSpy = vi.fn((handler: MessageHandler) => {
    handlers.delete(handler)
  })

  return {
    room: { roomId: "room-1", sessionId: "session-1" },
    onMessage: vi.fn((handler: MessageHandler) => {
      handlers.add(handler)
      return () => unsubscribeSpy(handler)
    }),
    emit(message: AnyWsMessage) {
      for (const handler of handlers) handler(message)
    },
    handlerCount() {
      return handlers.size
    },
    unsubscribeSpy,
    sendClientSceneReady: vi.fn(),
    isMatchInProgress: vi.fn(() => false),
    isConnected: vi.fn(() => true),
    sendRequestResync: vi.fn(),
    nextSeq: vi.fn(() => 1),
    sendPlayerInput: vi.fn(),
  }
}

function makeScene(connection: ReturnType<typeof makeConnection>) {
  const once = vi.fn()
  const graphics = vi.fn(() => ({
    destroy: vi.fn(),
    clear: vi.fn(),
    setDepth: vi.fn(),
  }))

  return {
    add: {
      group: vi.fn(() => ({})),
      graphics,
    },
    anims: {},
    cameras: {
      main: {
        setZoom: vi.fn(),
        setRoundPixels: vi.fn(),
        setBounds: vi.fn(),
        centerOn: vi.fn(),
      },
    },
    events: { once },
    game: {
      registry: {
        get: vi.fn((key: string) => {
          if (key === WW_GAME_CONNECTION_REGISTRY_KEY) return connection
          if (key === WW_LOCAL_PLAYER_ID_REGISTRY_KEY) return "player-1"
          return undefined
        }),
      },
    },
    __once: once,
    __graphics: graphics,
  }
}

function makeRuntime(connection = makeConnection()) {
  const scene = makeScene(connection)
  const runtime = new ArenaRuntime(scene as never, {
    arenaMap: {
      widthInPixels: 100,
      heightInPixels: 100,
      layers: [],
    } as never,
  })
  return { runtime, scene, connection }
}

describe("ArenaRuntime lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("unsubscribes from the shared GameConnection exactly once when destroyed", () => {
    const { runtime, connection } = makeRuntime()

    runtime.start()
    expect(connection.handlerCount()).toBe(1)

    runtime.destroy()
    runtime.destroy()

    expect(connection.unsubscribeSpy).toHaveBeenCalledTimes(1)
    expect(connection.handlerCount()).toBe(0)
  })

  it("does not handle room messages after destroy", () => {
    const { runtime, scene, connection } = makeRuntime()

    runtime.start()
    runtime.destroy()
    connection.emit({
      type: WsEvent.CombatTelegraphStart,
      payload: {
        id: "telegraph-1",
        casterId: "player-1",
        sourceId: "primary_melee",
        anchor: "caster",
        directionRad: 0,
        shape: { type: "cone", radiusPx: 10, arcDeg: 90 },
        startsAtServerTimeMs: 0,
        dangerStartsAtServerTimeMs: 0,
        dangerEndsAtServerTimeMs: 1,
        endsAtServerTimeMs: 1,
      },
    })

    expect(scene.__graphics).not.toHaveBeenCalled()
  })

  it("keeps one active room handler across sequential runtimes on the same connection", () => {
    const connection = makeConnection()
    const first = makeRuntime(connection)
    const second = makeRuntime(connection)

    first.runtime.start()
    first.runtime.destroy()
    second.runtime.start()

    expect(connection.handlerCount()).toBe(1)
  })
})
