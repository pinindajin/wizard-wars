import { z } from "zod"

import {
  ABILITY_BAR_SLOT_COUNT,
  QUICK_ITEM_SLOT_COUNT,
} from "./balance-config/economy"
import { MAX_PLAYERS_PER_MATCH } from "./balance-config/lobby"
import type { GameStateSyncPayload } from "./types"

/** Username: alphanumeric + underscore, 3-20 chars, must be trimmed before comparison. */
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/

const trimmedUsername = z
  .string()
  .trim()
  .regex(USERNAME_REGEX, "Username may only contain letters, numbers, and underscores")

/** Schema for login payloads and existing usernames (1-20 chars after trim). */
export const loginUsernameSchema = trimmedUsername.min(1).max(20)

/** Schema for new account signup (3-20 chars after trim, enforced in DB as case-insensitive unique). */
export const signupUsernameSchema = trimmedUsername
  .min(3, { message: "Username must be at least 3 characters." })
  .max(20, { message: "Username must be at most 20 characters." })

/** Schema for chat messages from the global /home room. */
export const chatMessagePayloadSchema = z.object({
  text: z.string().trim().min(1).max(200),
})

/** Schema for lobby chat messages. */
export const lobbyChatPayloadSchema = z.object({
  text: z.string().trim().min(1).max(200),
})

/** Schema for hero selection. */
export const heroSelectPayloadSchema = z.object({
  heroId: z.enum(["red_wizard", "barbarian", "ranger"]),
})

/** Schema for player input per tick. */
export const playerInputPayloadSchema = z.object({
  up: z.boolean(),
  down: z.boolean(),
  left: z.boolean(),
  right: z.boolean(),
  abilitySlot: z.number().int().min(0).max(ABILITY_BAR_SLOT_COUNT - 1).nullable(),
  abilityTargetX: z.number().finite(),
  abilityTargetY: z.number().finite(),
  weaponPrimary: z.boolean(),
  weaponSecondary: z.boolean(),
  weaponTargetX: z.number().finite(),
  weaponTargetY: z.number().finite(),
  useQuickItemSlot: z.number().int().min(0).max(QUICK_ITEM_SLOT_COUNT - 1).nullable(),
  seq: z.number().int().nonnegative(),
})

/** Schema for shop purchase. */
export const shopPurchasePayloadSchema = z.object({
  itemId: z.string().min(1).max(64),
})

/** Schema for equip item. */
export const equipItemPayloadSchema = z.object({
  itemId: z.string().min(1).max(64),
})

/** Schema for ability slot assignment. */
export const assignAbilityPayloadSchema = z.object({
  abilityId: z.string().min(1).max(64),
  slotIndex: z.number().int().min(0).max(ABILITY_BAR_SLOT_COUNT - 1),
})

/** Schema for use quick item. */
export const useQuickItemPayloadSchema = z.object({
  slotIndex: z.number().int().min(0).max(QUICK_ITEM_SLOT_COUNT - 1),
})

/** Schema for lobby player count (used in GET /api/lobbies). */
export const lobbyPlayerCountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_PLAYERS_PER_MATCH)

/** `PlayerAnimState` values used in snapshots and batch updates. */
export const playerAnimStateSchema = z.enum([
  "idle",
  "walk",
  "dying",
  "light_cast",
  "heavy_cast",
  "axe_swing",
  "dead",
])

/** Single player row in `GameStateSync`. */
export const playerSnapshotSchema = z.object({
  id: z.number().int().nonnegative(),
  playerId: z.string().min(1).max(256),
  username: z.string().max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  facingAngle: z.number().finite(),
  health: z.number().finite(),
  maxHealth: z.number().finite(),
  lives: z.number().int().nonnegative(),
  heroId: z.string().min(1).max(64),
  animState: playerAnimStateSchema,
  invulnerable: z.boolean(),
})

/** Full `game_state_sync` payload (server + client). */
export const gameStateSyncPayloadSchema = z.object({
  players: z.array(playerSnapshotSchema).max(MAX_PLAYERS_PER_MATCH),
  seq: z.number().int().nonnegative(),
})

/**
 * Parses and returns a `GameStateSyncPayload` (throws if invalid).
 * Call on the server before every `broadcast` / `client.send` of this message.
 */
export function parseGameStateSyncPayload(
  input: Readonly<unknown> | GameStateSyncPayload,
): GameStateSyncPayload {
  return gameStateSyncPayloadSchema.parse(input) as GameStateSyncPayload
}
