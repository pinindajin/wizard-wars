import { describe, it, expect } from "vitest"
import {
  signupUsernameSchema,
  loginUsernameSchema,
  chatMessagePayloadSchema,
  playerInputPayloadSchema,
  parseGameStateSyncPayload,
  parsePlayerDeathPayload,
} from "@/shared/validators"
import type { GameStateSyncPayload, PlayerDeathPayload } from "@/shared/types"

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
    const { clientSendTimeMs: _drop, ...withoutTime } = validInput
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
          castingAbilityId: null,
          invulnerable: false,
          jumpZ: 0,
          lastProcessedInputSeq: 0,
        },
      ],
      fireballs: [],
      seq: 0,
      serverTimeMs: 1700000000000,
    }
    const parsed = parseGameStateSyncPayload(raw)
    expect(parsed).toEqual(raw)
  })

  it("accepts fireballs in sync payload", () => {
    const raw: GameStateSyncPayload = {
      players: [],
      fireballs: [
        { id: 42, ownerId: "u1", x: 1, y: 2, vx: 100, vy: 0 },
      ],
      seq: 0,
      serverTimeMs: 1700000000000,
    }
    expect(parseGameStateSyncPayload(raw)).toEqual(raw)
  })

  it("rejects fireball with empty ownerId", () => {
    expect(() =>
      parseGameStateSyncPayload({
        players: [],
        fireballs: [{ id: 1, ownerId: "", x: 0, y: 0, vx: 1, vy: 0 }],
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
            castingAbilityId: null,
            invulnerable: false,
            lastProcessedInputSeq: 0,
          },
        ],
        fireballs: [],
        seq: 0,
        serverTimeMs: 1,
      } as never),
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
