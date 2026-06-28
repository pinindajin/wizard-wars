import { describe, it, expect } from "vitest"
import {
  signupUsernameSchema,
  chatMessagePayloadSchema,
  playerInputPayloadSchema,
  playerInputStatePayloadSchema,
  playerSnapshotSchema,
  homingOrbBatchUpdatePayloadSchema,
  homingOrbImpactPayloadSchema,
  homingOrbLaunchPayloadSchema,
  parseGameStateSyncPayload,
  parsePlayerInputStatePayload,
  parsePlayerOwnerAckPayload,
  parsePlayerDeathPayload,
  parseServerPerformanceStatusPayload,
} from "@/shared/validators"
import type {
  GameStateSyncPayload,
  PlayerOwnerAckPayload,
  PlayerDeathPayload,
  ServerPerformanceStatusPayload,
} from "@/shared/types"
import { WsEvent } from "@/shared/events"
import { RoomEvent, roomToWsEvent } from "@/shared/roomEvents"

function validAbilityStates() {
  return {
    fireball: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: null,
      maxCharges: null,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    jump: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 4,
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    homing_orb: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: 4,
      maxCharges: 4,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
  }
}

describe("signupUsernameSchema", () => {
  it("accepts valid usernames", () => {
    expect(signupUsernameSchema.safeParse("abc").success).toBe(true)
    expect(signupUsernameSchema.safeParse("wizard_wars").success).toBe(true)
    expect(signupUsernameSchema.safeParse("Player123").success).toBe(true)
    expect(signupUsernameSchema.safeParse("a".repeat(20)).success).toBe(true)
  })

  it("rejects usernames that are too short", () => {
    expect(signupUsernameSchema.safeParse("ab").success).toBe(false)
    expect(signupUsernameSchema.safeParse("").success).toBe(false)
  })

  it("rejects usernames that are too long", () => {
    expect(signupUsernameSchema.safeParse("a".repeat(21)).success).toBe(false)
  })

  it("rejects invalid characters", () => {
    expect(signupUsernameSchema.safeParse("user@name").success).toBe(false)
    expect(signupUsernameSchema.safeParse("user-name").success).toBe(false)
    expect(signupUsernameSchema.safeParse("user name").success).toBe(false)
    expect(signupUsernameSchema.safeParse("user.name").success).toBe(false)
  })

  it("trims whitespace", () => {
    const result = signupUsernameSchema.safeParse("  abc  ")
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toBe("abc")
  })
})

describe("chatMessagePayloadSchema", () => {
  it("accepts valid messages", () => {
    expect(chatMessagePayloadSchema.safeParse({ text: "hello" }).success).toBe(true)
    expect(chatMessagePayloadSchema.safeParse({ text: "a".repeat(200) }).success).toBe(true)
  })

  it("rejects empty messages", () => {
    expect(chatMessagePayloadSchema.safeParse({ text: "" }).success).toBe(false)
    expect(chatMessagePayloadSchema.safeParse({ text: "   " }).success).toBe(false)
  })

  it("rejects messages exceeding 200 chars", () => {
    expect(chatMessagePayloadSchema.safeParse({ text: "a".repeat(201) }).success).toBe(false)
  })
})

describe("playerInputPayloadSchema", () => {
  const validInput = {
    up: false, down: false, left: false, right: false,
    abilitySlot: null,
    abilityTargetX: 100, abilityTargetY: 200,
    weaponPrimary: false, weaponSecondary: false,
    weaponTargetX: 100, weaponTargetY: 200,
    useQuickItemSlot: null,
    seq: 42,
    clientSendTimeMs: 1700000000000,
  }

  it("accepts valid input", () => {
    expect(playerInputPayloadSchema.safeParse(validInput).success).toBe(true)
  })

  it("accepts ability slot 0-4", () => {
    for (let i = 0; i <= 4; i++) {
      expect(playerInputPayloadSchema.safeParse({ ...validInput, abilitySlot: i }).success).toBe(true)
    }
  })

  it("rejects ability slot out of range", () => {
    expect(playerInputPayloadSchema.safeParse({ ...validInput, abilitySlot: 5 }).success).toBe(false)
    expect(playerInputPayloadSchema.safeParse({ ...validInput, abilitySlot: -2 }).success).toBe(false)
  })

  it("requires seq to be non-negative", () => {
    expect(playerInputPayloadSchema.safeParse({ ...validInput, seq: -1 }).success).toBe(false)
  })

  it("requires clientSendTimeMs to be present", () => {
    const withoutTime: Partial<typeof validInput> = { ...validInput }
    delete withoutTime.clientSendTimeMs
    expect(playerInputPayloadSchema.safeParse(withoutTime).success).toBe(false)
  })

  it("rejects negative clientSendTimeMs", () => {
    expect(
      playerInputPayloadSchema.safeParse({ ...validInput, clientSendTimeMs: -1 }).success,
    ).toBe(false)
  })

  it("rejects NaN clientSendTimeMs", () => {
    expect(
      playerInputPayloadSchema.safeParse({ ...validInput, clientSendTimeMs: Number.NaN }).success,
    ).toBe(false)
  })
})

describe("playerInputStatePayloadSchema", () => {
  const validCompactInput = {
    protocolVersion: 1,
    seq: 42,
    clientSendTimeMs: 1700000000000,
    buttons: 63,
    targetX: 100,
    targetY: 200,
    abilitySlot: 0,
    useQuickItemSlot: 0,
  } as const

  it("accepts compact input state payloads", () => {
    expect(playerInputStatePayloadSchema.safeParse(validCompactInput).success).toBe(true)
  })

  it("parses compact input state payloads through the shared wrapper", () => {
    expect(parsePlayerInputStatePayload(validCompactInput)).toEqual(validCompactInput)
  })

  it("rejects out-of-range compact input buttons", () => {
    expect(
      playerInputStatePayloadSchema.safeParse({
        protocolVersion: 1,
        seq: 42,
        clientSendTimeMs: 1700000000000,
        buttons: 64,
        targetX: 100,
        targetY: 200,
      }).success,
    ).toBe(false)
  })
})

describe("playerSnapshotSchema", () => {
  it("accepts Swift Boots equipment state in snapshots and defaults old payloads to false", () => {
    const snapshot = {
      id: 1,
      playerId: "user-a",
      username: "Alice",
      x: 10,
      y: 20,
      vx: 0,
      vy: 0,
      facingAngle: 0,
      moveFacingAngle: 0,
      health: 100,
      maxHealth: 100,
      lives: 3,
      heroId: "red_wizard",
      animState: "idle",
      moveState: "idle",
      terrainState: "land",
      castingAbilityId: null,
      invulnerable: false,
      jumpZ: 0,
      jumpStartedInLava: false,
      abilityStates: validAbilityStates(),
      lastProcessedInputSeq: 0,
    } as const

    expect(playerSnapshotSchema.parse({ ...snapshot, hasSwiftBoots: true }))
      .toMatchObject({ hasSwiftBoots: true })
    expect(playerSnapshotSchema.parse(snapshot)).toMatchObject({
      hasSwiftBoots: false,
    })
  })

})

describe("ServerPerformanceStatus protocol", () => {
  const validStatus: ServerPerformanceStatusPayload = {
    serverTimeMs: 1_700_000_000_000,
    degraded: true,
    reasons: ["dropped_debt", "catch_up", "input_queue_drops"],
    metrics: {
      windowMs: 1_000,
      droppedDebtMs: 16.67,
      catchUpCallbacks: 2,
      inputQueueDrops: 1,
      simDurationMs: 5,
      broadcastDurationMs: 3,
      roomTickDurationMs: 8,
      visualFlushDurationMs: 2,
      ownerAckSendDurationMs: 1,
      immediateBroadcastDurationMs: 4,
      visualBudgetDeferrals: 3,
      visualBudgetDeferredEntities: 5,
      visualBudgetMaxDeferralAgeMs: 150,
      visualBudgetDroppedVisuals: 0,
      criticalSendFailures: 0,
      processEventLoopDelayMs: 12,
      processEventLoopDelayP95Ms: 7,
      eventLoopUtilization: 0.6,
      gcPauseMs: 9,
      eventLoopLagP95Ms: 12,
      eventLoopLagMs: 20,
      processCpuPercent: 85,
      heapUsedBytes: 1024,
      rssBytes: 2048,
      activeRooms: 1,
      connectedClients: 2,
    },
  }

  it("bridges the server performance room event to the websocket event", () => {
    expect(RoomEvent.ServerPerformanceStatus).toBe("server_performance_status")
    expect(WsEvent.ServerPerformanceStatus).toBe("SERVER_PERFORMANCE_STATUS")
    expect(roomToWsEvent[RoomEvent.ServerPerformanceStatus]).toBe(
      WsEvent.ServerPerformanceStatus,
    )
  })

  it("parses valid server performance status payloads", () => {
    expect(parseServerPerformanceStatusPayload(validStatus)).toEqual(validStatus)
  })

  it("accepts server performance payloads from before event-loop p95 metrics", () => {
    const { eventLoopLagP95Ms: _omitted, ...legacyMetrics } = validStatus.metrics
    const legacyStatus = {
      ...validStatus,
      metrics: legacyMetrics,
    }

    expect(parseServerPerformanceStatusPayload(legacyStatus)).toEqual(legacyStatus)
  })

  it("rejects unknown server performance status reasons", () => {
    expect(() =>
      parseServerPerformanceStatusPayload({
        ...validStatus,
        reasons: ["mystery"],
      } as never),
    ).toThrow()
  })

  it("bridges Homing Orb room events to websocket events", () => {
    expect(RoomEvent.HomingOrbLaunch).toBe("homing_orb_launch")
    expect(RoomEvent.HomingOrbBatchUpdate).toBe("homing_orb_batch_update")
    expect(RoomEvent.HomingOrbImpact).toBe("homing_orb_impact")
    expect(WsEvent.HomingOrbLaunch).toBe("HOMING_ORB_LAUNCH")
    expect(roomToWsEvent[RoomEvent.HomingOrbLaunch]).toBe(WsEvent.HomingOrbLaunch)
    expect(roomToWsEvent[RoomEvent.HomingOrbBatchUpdate]).toBe(
      WsEvent.HomingOrbBatchUpdate,
    )
    expect(roomToWsEvent[RoomEvent.HomingOrbImpact]).toBe(WsEvent.HomingOrbImpact)
  })

  it("bridges owner ACK room events to websocket events", () => {
    expect(RoomEvent.PlayerOwnerAck).toBe("player_owner_ack")
    expect(WsEvent.PlayerOwnerAck).toBe("PLAYER_OWNER_ACK")
    expect(roomToWsEvent[RoomEvent.PlayerOwnerAck]).toBe(WsEvent.PlayerOwnerAck)
  })

  it("bridges compact player input state room events to websocket events", () => {
    expect(RoomEvent.PlayerInputState).toBe("player_input_state")
    expect(WsEvent.PlayerInputState).toBe("PLAYER_INPUT_STATE")
    expect(roomToWsEvent[RoomEvent.PlayerInputState]).toBe(WsEvent.PlayerInputState)
  })
})

describe("parsePlayerOwnerAckPayload", () => {
  it("accepts a complete owner ACK replay context", () => {
    const raw: PlayerOwnerAckPayload = {
      id: 1,
      playerId: "user-a",
      x: 10,
      y: 20,
      vx: 100,
      vy: 0,
      lastProcessedInputSeq: 7,
      serverTimeMs: 1700000000000,
      replayContext: {
        moveState: "casting",
        terrainState: "lava",
        castingAbilityId: "fireball",
        jumpZ: 12,
        jumpStartedInLava: true,
        isSwinging: false,
        hasSwiftBoots: true,
      },
    }

    expect(parsePlayerOwnerAckPayload(raw)).toEqual(raw)
  })

  it("rejects malformed owner ACK replay context", () => {
    expect(() =>
      parsePlayerOwnerAckPayload({
        id: 1,
        playerId: "user-a",
        x: 10,
        y: 20,
        vx: 0,
        vy: 0,
        lastProcessedInputSeq: 7,
        serverTimeMs: 1700000000000,
        replayContext: {
          moveState: "teleporting",
          terrainState: "land",
          castingAbilityId: null,
          jumpZ: 0,
          jumpStartedInLava: false,
          isSwinging: false,
          hasSwiftBoots: false,
        },
      } as never),
    ).toThrow()
  })
})

describe("parseGameStateSyncPayload", () => {
  it("accepts a minimal valid GameStateSync payload (T4)", () => {
    const raw: GameStateSyncPayload = {
      players: [
        {
          id: 1,
          playerId: "user-a",
          username: "A",
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          facingAngle: 0,
          moveFacingAngle: 0,
          health: 10,
          maxHealth: 10,
          lives: 3,
          heroId: "red_wizard",
          animState: "idle",
          moveState: "idle",
          terrainState: "land",
          castingAbilityId: null,
          invulnerable: false,
          jumpZ: 0,
          jumpStartedInLava: false,
          hasSwiftBoots: false,
          abilityStates: validAbilityStates(),
          lastProcessedInputSeq: 0,
        },
      ],
      fireballs: [],
      homingOrbs: [],
      seq: 0,
      serverTimeMs: 1700000000000,
    }
    const parsed = parseGameStateSyncPayload(raw)
    expect(parsed).toEqual(raw)
  })

  it("accepts optional net timing in GameStateSync payloads", () => {
    const raw: GameStateSyncPayload = {
      players: [],
      fireballs: [],
      homingOrbs: [],
      seq: 0,
      serverTimeMs: 1700000000000,
      timing: {
        protocolVersion: 1,
        tickRateHz: 60,
        tickMs: 1000 / 60,
        netSendRateHz: 30,
        netSendIntervalMs: 1000 / 30,
        remoteRenderDelayMs: 84,
      },
    }

    expect(parseGameStateSyncPayload(raw)).toEqual(raw)
  })

  it("accepts optional compact input protocol in GameStateSync payloads", () => {
    const raw: GameStateSyncPayload = {
      players: [],
      fireballs: [],
      homingOrbs: [],
      seq: 0,
      serverTimeMs: 1700000000000,
      input: {
        protocolVersion: 2,
        preferredTransport: "compact",
        activeHeartbeatMs: 100,
        idleHeartbeatMs: 1_000,
      },
    }

    expect(parseGameStateSyncPayload(raw)).toEqual(raw)
  })

  it("rejects malformed compact input protocol in GameStateSync payloads", () => {
    expect(() =>
      parseGameStateSyncPayload({
        players: [],
        fireballs: [],
        seq: 0,
        serverTimeMs: 1700000000000,
        input: {
          protocolVersion: 2,
          preferredTransport: "compact",
          activeHeartbeatMs: 0,
          idleHeartbeatMs: 1_000,
        },
      } as never),
    ).toThrow()
  })

  it("rejects malformed net timing in GameStateSync payloads", () => {
    expect(() =>
      parseGameStateSyncPayload({
        players: [],
        fireballs: [],
        seq: 0,
        serverTimeMs: 1700000000000,
        timing: {
          protocolVersion: 1,
          tickRateHz: 60,
          tickMs: 1000 / 60,
          netSendRateHz: 30,
          netSendIntervalMs: Number.NaN,
          remoteRenderDelayMs: 84,
        },
      } as never),
    ).toThrow()
  })

  it("accepts fireballs in sync payload", () => {
    const raw: GameStateSyncPayload = {
      players: [],
      fireballs: [
        { id: 42, ownerId: "u1", x: 1, y: 2, vx: 100, vy: 0 },
      ],
      homingOrbs: [],
      seq: 0,
      serverTimeMs: 1700000000000,
    }
    expect(parseGameStateSyncPayload(raw)).toEqual(raw)
  })

  it("accepts homing orbs in sync payload", () => {
    const raw: GameStateSyncPayload = {
      players: [],
      fireballs: [],
      homingOrbs: [
        {
          id: 77,
          ownerId: "caster",
          targetId: "target",
          x: 10,
          y: 20,
          vx: 120,
          vy: 0,
          headingRad: 0,
          expiresAtServerTimeMs: 15_000,
        },
      ],
      seq: 0,
      serverTimeMs: 1,
    }
    expect(parseGameStateSyncPayload(raw)).toEqual(raw)
  })

  it("rejects fireball with empty ownerId", () => {
    expect(() =>
      parseGameStateSyncPayload({
        players: [],
        fireballs: [{ id: 1, ownerId: "", x: 0, y: 0, vx: 1, vy: 0 }],
        homingOrbs: [],
        seq: 0,
        serverTimeMs: 1,
      } as never),
    ).toThrow()
  })

  it("rejects homing orb with non-finite heading", () => {
    expect(() =>
      parseGameStateSyncPayload({
        players: [],
        fireballs: [],
        homingOrbs: [
          {
            id: 77,
            ownerId: "caster",
            x: 10,
            y: 20,
            vx: 120,
            vy: 0,
            headingRad: Number.NaN,
            expiresAtServerTimeMs: 15_000,
          },
        ],
        seq: 0,
        serverTimeMs: 1,
      } as never),
    ).toThrow()
  })

  it("rejects an invalid animState", () => {
    expect(() =>
      parseGameStateSyncPayload({
        players: [
          {
            id: 1,
            playerId: "u",
            username: "x",
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            facingAngle: 0,
            moveFacingAngle: 0,
            health: 1,
            maxHealth: 1,
            lives: 1,
            heroId: "red_wizard",
            animState: "invalid",
            moveState: "idle",
            terrainState: "land",
            castingAbilityId: null,
            invulnerable: false,
            jumpZ: 0,
            jumpStartedInLava: false,
            abilityStates: validAbilityStates(),
            lastProcessedInputSeq: 0,
          },
        ],
        fireballs: [],
        homingOrbs: [],
        seq: 0,
        serverTimeMs: 1,
      } as never),
    ).toThrow()
  })

  it("rejects malformed ability runtime state", () => {
    expect(() =>
      parseGameStateSyncPayload({
        players: [
          {
            id: 1,
            playerId: "u",
            username: "x",
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            facingAngle: 0,
            moveFacingAngle: 0,
            health: 1,
            maxHealth: 1,
            lives: 1,
            heroId: "red_wizard",
            animState: "idle",
            moveState: "idle",
            terrainState: "land",
            castingAbilityId: null,
            invulnerable: false,
            jumpZ: 0,
            jumpStartedInLava: false,
            abilityStates: {
              jump: {
                cooldownEndsAtServerTimeMs: null,
                cooldownDurationMs: null,
                charges: -1,
                maxCharges: 4,
                rechargeEndsAtServerTimeMs: null,
                rechargeDurationMs: null,
              },
            },
            lastProcessedInputSeq: 0,
          },
        ],
        fireballs: [],
        homingOrbs: [],
        seq: 0,
        serverTimeMs: 1,
      } as never),
    ).toThrow()
  })
})

describe("Homing Orb protocol schemas", () => {
  it("accepts launch, batch update, and impact payloads", () => {
    expect(homingOrbLaunchPayloadSchema.parse({
      id: 1,
      ownerId: "caster",
      targetId: "target",
      x: 10,
      y: 20,
      vx: 120,
      vy: 0,
      headingRad: 0,
      expiresAtServerTimeMs: 15_000,
    })).toMatchObject({ id: 1, targetId: "target" })

    expect(homingOrbBatchUpdatePayloadSchema.parse({
      deltas: [{ id: 1, x: 11, y: 20, vx: 130, vy: 0, headingRad: 0.1 }],
      removedIds: [],
      seq: 2,
      serverTimeMs: 1_700_000_000_100,
    })).toMatchObject({ seq: 2, serverTimeMs: 1_700_000_000_100 })

    expect(homingOrbBatchUpdatePayloadSchema.parse({
      deltas: [{ id: 1, x: 12, y: 21 }, { id: 2, targetId: null }],
      removedIds: [],
      seq: 3,
      serverTimeMs: 1_700_000_000_133,
    })).toMatchObject({
      deltas: [{ id: 1, x: 12, y: 21 }, { id: 2, targetId: null }],
    })

    expect(homingOrbImpactPayloadSchema.parse({
      id: 1,
      x: 12,
      y: 20,
      reason: "expired",
      hitPlayerIds: ["target"],
      damage: 4,
    })).toMatchObject({ reason: "expired", damage: 4 })
  })

  it("rejects malformed Homing Orb protocol payloads", () => {
    expect(() =>
      homingOrbLaunchPayloadSchema.parse({
        id: 1,
        ownerId: "caster",
        x: 10,
        y: 20,
        vx: 120,
        vy: 0,
        headingRad: Number.NaN,
        expiresAtServerTimeMs: 15_000,
      }),
    ).toThrow()

    expect(() =>
      homingOrbImpactPayloadSchema.parse({
        id: 1,
        x: 12,
        y: 20,
        reason: "miss",
      }),
    ).toThrow()

    expect(() =>
      homingOrbBatchUpdatePayloadSchema.parse({
        deltas: [{ id: 1 }],
        removedIds: [],
        seq: 3,
      }),
    ).toThrow()
  })
})

describe("parsePlayerDeathPayload", () => {
  it("accepts death with usernames", () => {
    const raw: PlayerDeathPayload = {
      playerId: "victim",
      killerPlayerId: "killer",
      killerAbilityId: "fireball",
      livesRemaining: 2,
      x: 10,
      y: 20,
      victimUsername: "Vic",
      killerUsername: "Kil",
    }
    expect(parsePlayerDeathPayload(raw)).toEqual(raw)
  })

  it("accepts null killer and ability", () => {
    const raw: PlayerDeathPayload = {
      playerId: "victim",
      killerPlayerId: null,
      killerAbilityId: null,
      livesRemaining: 0,
      x: 0,
      y: 0,
    }
    expect(parsePlayerDeathPayload(raw)).toEqual(raw)
  })
})
