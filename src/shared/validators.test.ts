import { describe, it, expect } from "vitest"
import {
  signupUsernameSchema,
  loginUsernameSchema,
  chatMessagePayloadSchema,
  playerInputPayloadSchema,
  parseGameStateSyncPayload,
} from "@/shared/validators"
import type { GameStateSyncPayload } from "@/shared/types"

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
          facingAngle: 0,
          health: 10,
          maxHealth: 10,
          lives: 3,
          heroId: "red_wizard",
          animState: "idle",
          invulnerable: false,
        },
      ],
      seq: 0,
    }
    const parsed = parseGameStateSyncPayload(raw)
    expect(parsed).toEqual(raw)
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
            facingAngle: 0,
            health: 1,
            maxHealth: 1,
            lives: 1,
            heroId: "red_wizard",
            animState: "invalid",
            invulnerable: false,
          },
        ],
        seq: 0,
      } as never),
    ).toThrow()
  })
})
