import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  WW_ACTIVE_LOCAL_INPUT_CALLBACK_REGISTRY_KEY,
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
} from "../constants"
import { ArenaRuntime } from "./ArenaRuntime"
import { WsEvent } from "@/shared/events"
import type {
  AnyWsMessage,
  MessageHandler,
  PlayerInputStatePayload,
} from "@/shared/types"
import { SFX_KEYS } from "@/shared/balance-config/audio"

const soundPlaySpy = vi.hoisted(() => vi.fn())
const activeLocalInputSpy = vi.hoisted(() => vi.fn())

function lastCoveredInputSeq(payload: PlayerInputStatePayload): number {
  return payload.runs[payload.runs.length - 1]?.toSeq ?? -1
}

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
  applyNetTiming: vi.fn(),
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
  setPredictionCorrectionHandler: vi.fn(),
  destroy: vi.fn(),
}))

const projectileRenderMock = vi.hoisted(() => ({
  applyFullSyncFireballs: vi.fn(),
  applyFullSyncHomingOrbs: vi.fn(),
  applyNetTiming: vi.fn(),
  updateServerTimeOffset: vi.fn(),
  spawnFireball: vi.fn(),
  spawnHomingOrb: vi.fn(),
  applyBatchUpdate: vi.fn(),
  applyHomingOrbBatchUpdate: vi.fn(),
  destroyFireball: vi.fn(),
  destroyHomingOrb: vi.fn(),
  update: vi.fn(),
}))

const keyboardControllerMock = vi.hoisted(() => ({
  enable: vi.fn(),
  collectInput: vi.fn(),
  collectMoveIntent: vi.fn(),
}))

const mouseControllerMock = vi.hoisted(() => ({
  enable: vi.fn(),
  collectInput: vi.fn(),
}))

const networkSyncHooks = vi.hoisted(() => ({
  current: null as {
    onLocalAck?: (sample: {
      readonly id: number
      readonly x: number
      readonly y: number
      readonly lastProcessedInputSeq: number
      readonly replayContext?: {
        readonly moveState: "idle" | "moving" | "casting" | "rooted" | "swinging"
        readonly terrainState: "land" | "lava" | "cliff"
        readonly castingAbilityId: string | null
        readonly jumpZ: number
        readonly jumpStartedInLava: boolean
        readonly isSwinging: boolean
        readonly hasSwiftBoots: boolean
      }
    }) => void
    onNetTiming?: (timing: unknown) => void
    onServerTime?: (serverTimeMs: number) => void
  } | null,
}))

const networkSyncMock = vi.hoisted(() => ({
  localPlayerId: null as string | null,
  applyFullSync: vi.fn(),
  applyBatchUpdate: vi.fn(),
  applyOwnerAck: vi.fn(),
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
  ProjectileRenderSystem: vi.fn().mockImplementation(() => projectileRenderMock),
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
  NetworkSyncSystem: vi.fn().mockImplementation((hooks) => {
    networkSyncHooks.current = hooks
    return networkSyncMock
  }),
}))

vi.mock("../input/KeyboardController", () => ({
  KeyboardController: vi.fn().mockImplementation(() => keyboardControllerMock),
}))

vi.mock("../input/MouseController", () => ({
  MouseController: vi.fn().mockImplementation(() => mouseControllerMock),
}))

vi.mock("../audio/BgmPlayer", () => ({
  BgmPlayer: vi.fn().mockImplementation(() => ({
    startBattleMusic: vi.fn(),
    setMasterBgmVolume: vi.fn(),
  })),
}))

vi.mock("../audio/SoundManager", () => ({
  SoundManager: vi.fn().mockImplementation(() => ({
    play: soundPlaySpy,
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
  registerHeroSpriteAnims: vi.fn(),
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
    sendPlayerInputState: vi.fn(),
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
          if (key === WW_ACTIVE_LOCAL_INPUT_CALLBACK_REGISTRY_KEY) {
            return activeLocalInputSpy
          }
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
    arenaWidthPx: 100,
    arenaHeightPx: 100,
  })
  return { runtime, scene, connection }
}

function mockPlayerRenderSimSteps(stepCount: () => number): void {
  playerRenderMock.update.mockImplementation(
    (
      _delta: number,
      _intent: unknown,
      onSimStep?: (input: unknown) => void,
      inputForSimStep?: () => unknown,
    ) => {
      for (let i = 0; i < stepCount(); i++) {
        const input = inputForSimStep?.() ?? null
        onSimStep?.(input)
      }
    },
  )
}

describe("ArenaRuntime lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeLocalInputSpy.mockClear()
    telegraphMock.start.mockClear()
    playerRenderMock.onPrimaryMeleeSwing.mockClear()
    networkSyncHooks.current = null
    networkSyncMock.applyOwnerAck.mockClear()
    keyboardControllerMock.collectMoveIntent.mockReturnValue({
      up: false,
      down: false,
      left: false,
      right: false,
    })
    keyboardControllerMock.collectInput.mockImplementation((seq: number) => ({
      up: false,
      down: false,
      left: false,
      right: false,
      abilitySlot: null,
      abilityTargetX: 0,
      abilityTargetY: 0,
      useQuickItemSlot: null,
      seq,
    }))
    mouseControllerMock.collectInput.mockReturnValue({
      weaponPrimary: false,
      weaponSecondary: false,
      weaponTargetX: 0,
      weaponTargetY: 0,
    })
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
        attackId: "yen_cleaver",
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

  it("plays fireball cast SFX when FireballLaunch is received", () => {
    const { runtime, connection } = makeRuntime()

    runtime.start()
    soundPlaySpy.mockClear()

    connection.emit({
      type: WsEvent.FireballLaunch,
      payload: {
        id: 1,
        ownerId: "p1",
        x: 10,
        y: 20,
        vx: 100,
        vy: 0,
      },
    })

    expect(soundPlaySpy).toHaveBeenCalledWith(SFX_KEYS.fireballCast)
  })

  it("spawns Homing Orb and plays its cast SFX when HomingOrbLaunch is received", () => {
    const { runtime, connection } = makeRuntime()

    runtime.start()
    soundPlaySpy.mockClear()
    projectileRenderMock.spawnHomingOrb.mockClear()

    const payload = {
      id: 9,
      ownerId: "p1",
      targetId: "p2",
      x: 10,
      y: 20,
      vx: 120,
      vy: 0,
      headingRad: 0,
      expiresAtServerTimeMs: 15_000,
    }
    connection.emit({
      type: WsEvent.HomingOrbLaunch,
      payload,
    })

    expect(projectileRenderMock.spawnHomingOrb).toHaveBeenCalledWith(payload)
    expect(soundPlaySpy).toHaveBeenCalledWith(SFX_KEYS.homingOrbCast)
  })

  it("destroys Homing Orb and plays impact/expiry SFX when HomingOrbImpact is received", () => {
    const { runtime, connection } = makeRuntime()

    runtime.start()
    soundPlaySpy.mockClear()
    projectileRenderMock.destroyHomingOrb.mockClear()

    connection.emit({
      type: WsEvent.HomingOrbImpact,
      payload: {
        id: 9,
        x: 10,
        y: 20,
        reason: "expired",
        hitPlayerIds: ["p2"],
        damage: 4,
      },
    })

    expect(projectileRenderMock.destroyHomingOrb).toHaveBeenCalledWith(9)
    expect(soundPlaySpy).toHaveBeenCalledWith(SFX_KEYS.homingOrbExpire)
  })

  it("hydrates projectiles from full game state sync with the snapshot server time", () => {
    const { runtime, connection } = makeRuntime()
    const payload = {
      players: [],
      fireballs: [],
      homingOrbs: [
        {
          id: 12,
          ownerId: "caster",
          x: 10,
          y: 20,
          vx: 30,
          vy: 40,
          headingRad: 0.25,
          expiresAtServerTimeMs: 15_000,
        },
      ],
      activeTelegraphs: [],
      seq: 0,
      serverTimeMs: 4_000,
    }

    runtime.start()
    connection.emit({ type: WsEvent.GameStateSync, payload })

    expect(projectileRenderMock.applyFullSyncFireballs).toHaveBeenCalledWith(
      [],
      4_000,
    )
    expect(projectileRenderMock.applyFullSyncHomingOrbs).toHaveBeenCalledWith(
      payload.homingOrbs,
      4_000,
    )
  })

  it("treats omitted Homing Orbs in full game state sync as an empty snapshot", () => {
    const { runtime, connection } = makeRuntime()
    const payload = {
      players: [],
      fireballs: [],
      activeTelegraphs: [],
      seq: 0,
      serverTimeMs: 4_250,
    }

    runtime.start()
    connection.emit({ type: WsEvent.GameStateSync, payload })

    expect(projectileRenderMock.applyFullSyncHomingOrbs).toHaveBeenCalledWith(
      [],
      4_250,
    )
  })

  it("routes player batch updates into NetworkSyncSystem", () => {
    const { runtime, connection } = makeRuntime()
    const payload = {
      players: [],
      seq: 7,
      serverTimeMs: 5_000,
    }

    runtime.start()
    connection.emit({ type: WsEvent.PlayerBatchUpdate, payload })

    expect(networkSyncMock.applyBatchUpdate).toHaveBeenCalledWith(payload)
  })

  it("sends a fresh input sequence for each fixed sim step in one render frame", () => {
    const { runtime, connection } = makeRuntime()
    let seq = 0
    connection.nextSeq.mockImplementation(() => seq++)
    mockPlayerRenderSimSteps(() => 3)

    runtime.start()
    connection.emit({ type: WsEvent.MatchGo, payload: {} })
    runtime.update(0, 51)

    expect(connection.sendPlayerInput.mock.calls.map(([input]) => input.seq)).toEqual([
      0,
      1,
      2,
    ])
    expect(connection.sendPlayerInputState).not.toHaveBeenCalled()
    expect(keyboardControllerMock.collectMoveIntent).toHaveBeenCalled()
  })

  it("does not append or send local sim ticks that have no connected input", () => {
    const { runtime, connection } = makeRuntime()
    connection.isConnected.mockReturnValue(false)
    playerRenderMock.update.mockImplementation(
      (
        _delta: number,
        _intent: unknown,
        onSimStep?: (input: unknown) => void,
        inputForSimStep?: () => unknown,
      ) => {
        expect(inputForSimStep?.()).toBeNull()
        onSimStep?.({
          up: true,
          down: false,
          left: false,
          right: false,
          abilitySlot: null,
          abilityTargetX: 0,
          abilityTargetY: 0,
          weaponPrimary: false,
          weaponSecondary: false,
          weaponTargetX: 0,
          weaponTargetY: 0,
          useQuickItemSlot: null,
          seq: 1,
          clientSendTimeMs: 10,
        })
        onSimStep?.(null)
      },
    )

    runtime.start()
    connection.emit({ type: WsEvent.MatchGo, payload: {} })
    runtime.update(0, 17)

    expect(playerRenderMock.localInputHistory.append).not.toHaveBeenCalled()
    expect(connection.sendPlayerInput).not.toHaveBeenCalled()
    expect(connection.sendPlayerInputState).not.toHaveBeenCalled()
    expect(keyboardControllerMock.collectInput).not.toHaveBeenCalled()
  })

  it("records every local tick but sends compact state only when the server advertises it", () => {
    const { runtime, connection } = makeRuntime()
    let seq = 0
    connection.nextSeq.mockImplementation(() => seq++)
    mockPlayerRenderSimSteps(() => 3)

    runtime.start()
    connection.emit({
      type: WsEvent.MatchGo,
      payload: {
        input: {
          protocolVersion: 2,
          preferredTransport: "compact",
          activeHeartbeatMs: 100,
          idleHeartbeatMs: 1_000,
        },
      },
    })
    runtime.update(0, 51)

    expect(
      playerRenderMock.localInputHistory.append.mock.calls.map(([input]) => input.seq),
    ).toEqual([0, 1, 2])
    expect(connection.sendPlayerInput).not.toHaveBeenCalled()
    expect(
      connection.sendPlayerInputState.mock.calls.map(([payload]) =>
        lastCoveredInputSeq(payload),
      ),
    ).toEqual([0])
  })

  it("preserves pending compact runs when full sync repeats unchanged input protocol", () => {
    vi.useFakeTimers()
    try {
      const { runtime, connection } = makeRuntime()
      let seq = 0
      let simSteps = 3
      const inputProtocol = {
        protocolVersion: 2 as const,
        preferredTransport: "compact" as const,
        activeHeartbeatMs: 100,
        idleHeartbeatMs: 1_000,
      }
      connection.nextSeq.mockImplementation(() => seq++)
      keyboardControllerMock.collectInput.mockImplementation((nextSeq: number) => ({
        up: false,
        down: false,
        left: false,
        right: true,
        abilitySlot: null,
        abilityTargetX: 0,
        abilityTargetY: 0,
        useQuickItemSlot: null,
        seq: nextSeq,
      }))
      mockPlayerRenderSimSteps(() => simSteps)

      runtime.start()
      vi.setSystemTime(1_000)
      connection.emit({
        type: WsEvent.MatchGo,
        payload: { input: inputProtocol },
      })
      runtime.update(0, 51)
      expect(connection.sendPlayerInputState).toHaveBeenCalledTimes(1)

      connection.emit({
        type: WsEvent.GameStateSync,
        payload: {
          players: [],
          fireballs: [],
          homingOrbs: [],
          activeTelegraphs: [],
          seq: 1,
          serverTimeMs: 1_050,
          input: inputProtocol,
        },
      })

      vi.setSystemTime(1_100)
      simSteps = 4
      runtime.update(0, 68)

      const secondState = connection.sendPlayerInputState.mock.calls[1]?.[0]
      expect(secondState).toEqual({
        protocolVersion: 2,
        runs: [
          expect.objectContaining({
            fromSeq: 1,
            toSeq: 3,
          }),
        ],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("resets pending compact runs when full sync marks the input stream reset", () => {
    vi.useFakeTimers()
    try {
      const { runtime, connection } = makeRuntime()
      let seq = 0
      let simSteps = 3
      const inputProtocol = {
        protocolVersion: 2 as const,
        preferredTransport: "compact" as const,
        activeHeartbeatMs: 100,
        idleHeartbeatMs: 1_000,
      }
      connection.nextSeq.mockImplementation(() => seq++)
      keyboardControllerMock.collectInput.mockImplementation((nextSeq: number) => ({
        up: false,
        down: false,
        left: false,
        right: true,
        abilitySlot: null,
        abilityTargetX: 0,
        abilityTargetY: 0,
        useQuickItemSlot: null,
        seq: nextSeq,
      }))
      mockPlayerRenderSimSteps(() => simSteps)

      runtime.start()
      vi.setSystemTime(1_000)
      connection.emit({
        type: WsEvent.MatchGo,
        payload: { input: inputProtocol },
      })
      runtime.update(0, 51)
      expect(connection.sendPlayerInputState).toHaveBeenCalledTimes(1)

      connection.emit({
        type: WsEvent.GameStateSync,
        payload: {
          players: [],
          fireballs: [],
          homingOrbs: [],
          activeTelegraphs: [],
          seq: 1,
          serverTimeMs: 1_050,
          input: inputProtocol,
          inputStreamReset: true,
        },
      })

      vi.setSystemTime(1_100)
      simSteps = 1
      runtime.update(0, 17)

      const secondState = connection.sendPlayerInputState.mock.calls[1]?.[0]
      expect(secondState).toEqual({
        protocolVersion: 2,
        runs: [
          expect.objectContaining({
            fromSeq: 3,
            toSeq: 3,
          }),
        ],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("continues reporting active local input even when compact wire sends are suppressed", () => {
    const { runtime, connection } = makeRuntime()
    let seq = 0
    connection.nextSeq.mockImplementation(() => seq++)
    keyboardControllerMock.collectInput.mockImplementation((nextSeq: number) => ({
      up: false,
      down: false,
      left: false,
      right: true,
      abilitySlot: null,
      abilityTargetX: 0,
      abilityTargetY: 0,
      useQuickItemSlot: null,
      seq: nextSeq,
    }))
    mockPlayerRenderSimSteps(() => 3)

    runtime.start()
    connection.emit({
      type: WsEvent.MatchGo,
      payload: {
        input: {
          protocolVersion: 2,
          preferredTransport: "compact",
          activeHeartbeatMs: 100,
          idleHeartbeatMs: 1_000,
        },
      },
    })
    runtime.update(0, 51)

    expect(activeLocalInputSpy).toHaveBeenCalledTimes(3)
    expect(
      connection.sendPlayerInputState.mock.calls.map(([payload]) =>
        lastCoveredInputSeq(payload),
      ),
    ).toEqual([0])
  })

  it("applies optional MatchGo net timing while preserving empty payload compatibility", () => {
    const { runtime, connection } = makeRuntime()
    const timing = {
      protocolVersion: 1,
      tickRateHz: 60,
      tickMs: 1000 / 60,
      netSendRateHz: 30,
      netSendIntervalMs: 1000 / 30,
      remoteRenderDelayMs: 84,
    }

    runtime.start()
    connection.emit({ type: WsEvent.MatchGo, payload: {} })
    connection.emit({ type: WsEvent.MatchGo, payload: { timing } })

    expect(keyboardControllerMock.enable).toHaveBeenCalled()
    expect(mouseControllerMock.enable).toHaveBeenCalled()
    expect(playerRenderMock.applyNetTiming).toHaveBeenCalledTimes(1)
    expect(playerRenderMock.applyNetTiming).toHaveBeenCalledWith(timing)
    expect(projectileRenderMock.applyNetTiming).toHaveBeenCalledTimes(1)
    expect(projectileRenderMock.applyNetTiming).toHaveBeenCalledWith(timing)
  })

  it("forwards full-sync net timing from NetworkSyncSystem into player rendering", () => {
    const { runtime } = makeRuntime()
    const timing = {
      protocolVersion: 1,
      tickRateHz: 60,
      tickMs: 1000 / 60,
      netSendRateHz: 60,
      netSendIntervalMs: 1000 / 60,
      remoteRenderDelayMs: 50,
    }

    runtime.start()
    networkSyncHooks.current?.onNetTiming?.(timing)

    expect(playerRenderMock.applyNetTiming).toHaveBeenCalledWith(timing)
    expect(projectileRenderMock.applyNetTiming).toHaveBeenCalledWith(timing)
  })

  it("forwards server time from NetworkSyncSystem into player rendering", () => {
    const { runtime } = makeRuntime()

    runtime.start()
    networkSyncHooks.current?.onServerTime?.(4_321)

    expect(playerRenderMock.updateServerTimeOffset).toHaveBeenCalledWith(4_321)
    expect(projectileRenderMock.updateServerTimeOffset).toHaveBeenCalledWith(4_321)
  })

  it("forwards local owner ACK samples from NetworkSyncSystem into player rendering", () => {
    const { runtime } = makeRuntime()
    const replayContext = {
      moveState: "idle" as const,
      terrainState: "land" as const,
      castingAbilityId: null,
      jumpZ: 0,
      jumpStartedInLava: false,
      isSwinging: false,
      hasSwiftBoots: true,
    }

    runtime.start()
    networkSyncHooks.current?.onLocalAck?.({
      id: 1,
      x: 10,
      y: 20,
      lastProcessedInputSeq: 7,
      replayContext,
    })

    expect(playerRenderMock.onLocalAck).toHaveBeenCalledWith(1, {
      x: 10,
      y: 20,
      lastProcessedInputSeq: 7,
      replayContext,
    })
  })

  it("routes dedicated owner ACK messages into NetworkSyncSystem", () => {
    const { runtime, connection } = makeRuntime()
    const payload = {
      id: 1,
      playerId: "player-1",
      x: 10,
      y: 20,
      vx: 0,
      vy: 0,
      lastProcessedInputSeq: 7,
      serverTimeMs: 1234,
      replayContext: {
        moveState: "idle",
        terrainState: "land",
        castingAbilityId: null,
        jumpZ: 0,
        jumpStartedInLava: false,
        isSwinging: false,
        hasSwiftBoots: false,
      },
    }

    runtime.start()
    connection.emit({ type: WsEvent.PlayerOwnerAck, payload })

    expect(networkSyncMock.applyOwnerAck).toHaveBeenCalledWith(payload)
  })

  it("plays local damage-dealt feedback for authored damage floats", () => {
    const { runtime, connection } = makeRuntime()

    runtime.start()
    soundPlaySpy.mockClear()

    connection.emit({
      type: WsEvent.DamageFloat,
      payload: {
        targetId: "enemy-player",
        attackerUserId: "player-1",
        amount: 4,
        x: 10,
        y: 20,
      },
    })

    expect(soundPlaySpy).toHaveBeenCalledWith(SFX_KEYS.hitDeal)
    expect(playerRenderMock.triggerHitFeedbackFlashForPlayerUserId).toHaveBeenCalledWith(
      "player-1",
    )
  })
})
