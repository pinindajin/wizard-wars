import { beforeEach, describe, expect, it, vi } from "vitest"

import { WW_GAME_CONNECTION_REGISTRY_KEY, WW_LOCAL_PLAYER_ID_REGISTRY_KEY } from "../constants"
import { ArenaRuntime } from "./ArenaRuntime"
import { WsEvent } from "@/shared/events"
import type { AnyWsMessage, MessageHandler } from "@/shared/types"

const telegraphMock = vi.hoisted(() => ({
  applyFullSync: vi.fn(),
  start: vi.fn(),
  end: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
}))

const playerRenderMock = vi.hoisted(() => ({
  localPlayerId: null as string | null,
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
  destroy: vi.fn(),
}))

vi.mock("phaser", () => {
  const letters = "abcdefghijklmnopqrstuvwxyz"
  const KeyCodes: Record<string, number> = {
    TAB: 9,
    BACK_SLASH: 220,
    SPACE: 32,
    SHIFT: 16,
    CTRL: 17,
    ALT: 18,
    UP: 38,
    DOWN: 40,
    LEFT: 37,
    RIGHT: 39,
    ZERO: 48,
    ONE: 49,
    TWO: 50,
    THREE: 51,
    FOUR: 52,
    FIVE: 53,
    SIX: 54,
    SEVEN: 55,
    EIGHT: 56,
    NINE: 57,
  }
  for (let i = 0; i < letters.length; i++) {
    KeyCodes[letters[i]!.toUpperCase()] = 65 + i
  }
  return {
    default: {
      Input: {
        Keyboard: {
          KeyCodes,
          JustDown: vi.fn(() => false),
        },
      },
      Scenes: {
        Events: {
          SHUTDOWN: "shutdown",
        },
      },
    },
  }
})

vi.mock("../ecs/systems/CombatTelegraphRenderSystem", () => ({
  CombatTelegraphRenderSystem: vi.fn().mockImplementation(() => telegraphMock),
}))

vi.mock("../ecs/systems/PlayerRenderSystem", () => ({
  PlayerRenderSystem: vi.fn().mockImplementation(() => playerRenderMock),
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

vi.mock("@/game/minimap/MinimapController", () => ({
  MinimapController: vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
    setCorner: vi.fn(),
    update: vi.fn(),
  })),
}))

vi.mock("@/game/animation/LadyWizardAnimDefs", () => ({
  registerLadyWizardAnims: vi.fn(),
}))

vi.mock("@/game/animation/FireballAnimDefs", () => ({
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
  const mockGfx = {
    setDepth: vi.fn(),
    setVisible: vi.fn(),
    clear: vi.fn(),
    lineStyle: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    strokePath: vi.fn(),
    closePath: vi.fn(),
  }

  return {
    add: {
      group: vi.fn(() => ({})),
      graphics: vi.fn(() => mockGfx),
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
    input: {
      keyboard: {
        addKey: vi.fn(() => ({ isDown: false })),
      },
      activePointer: {
        leftButtonDown: vi.fn(() => false),
        rightButtonDown: vi.fn(() => false),
        positionToCamera: vi.fn(() => ({ x: 0, y: 0 })),
      },
    },
    events: { once },
    cache: {
      audio: {
        exists: vi.fn(() => false),
      },
    },
    tweens: {
      killTweensOf: vi.fn(),
    },
    sound: {
      add: vi.fn(() => ({
        play: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        isPlaying: false,
        once: vi.fn(),
      })),
    },
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
    telegraphMock.start.mockClear()
    playerRenderMock.onPrimaryMeleeSwing.mockClear()
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
    const { runtime, connection } = makeRuntime()

    runtime.start()
    runtime.destroy()
    telegraphMock.start.mockClear()

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

    expect(telegraphMock.start).not.toHaveBeenCalled()
  })

  it("does not invoke PlayerRenderSystem for PrimaryMeleeAttack after destroy (generation)", () => {
    const { runtime, connection } = makeRuntime()

    runtime.start()
    playerRenderMock.onPrimaryMeleeSwing.mockClear()
    runtime.destroy()

    connection.emit({
      type: WsEvent.PrimaryMeleeAttack,
      payload: {
        casterId: "player-1",
        attackId: "red_wizard_cleaver",
        x: 0,
        y: 0,
        facingAngle: 0,
        damage: 10,
        hurtboxRadiusPx: 80,
        hurtboxArcDeg: 90,
        durationMs: 200,
        dangerousWindowStartMs: 0,
        dangerousWindowEndMs: 200,
      },
    })

    expect(playerRenderMock.onPrimaryMeleeSwing).not.toHaveBeenCalled()
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
