import type {
  PlayerInputCommandRunPayload,
  PlayerInputPayload,
} from "./types"

/** Bit mask for all buttons represented by compact player input state. */
export const PLAYER_INPUT_BUTTON_BITS = {
  up: 1 << 0,
  down: 1 << 1,
  left: 1 << 2,
  right: 1 << 3,
  weaponPrimary: 1 << 4,
  weaponSecondary: 1 << 5,
} as const

/** Maximum valid compact button mask. */
export const PLAYER_INPUT_BUTTONS_MAX =
  PLAYER_INPUT_BUTTON_BITS.up |
  PLAYER_INPUT_BUTTON_BITS.down |
  PLAYER_INPUT_BUTTON_BITS.left |
  PLAYER_INPUT_BUTTON_BITS.right |
  PLAYER_INPUT_BUTTON_BITS.weaponPrimary |
  PLAYER_INPUT_BUTTON_BITS.weaponSecondary
export const MAX_PLAYER_INPUT_COMMAND_RUN_SPAN_TICKS = 30
export const MAX_PLAYER_INPUT_COMMAND_RUNS_PER_BATCH = 16

/**
 * Builds a compact button mask from a canonical full input payload.
 *
 * @param input - Full player input payload.
 * @returns Bit mask containing held movement and weapon buttons.
 */
export function playerInputButtonsFromPayload(input: PlayerInputPayload): number {
  let buttons = 0
  if (input.up) buttons |= PLAYER_INPUT_BUTTON_BITS.up
  if (input.down) buttons |= PLAYER_INPUT_BUTTON_BITS.down
  if (input.left) buttons |= PLAYER_INPUT_BUTTON_BITS.left
  if (input.right) buttons |= PLAYER_INPUT_BUTTON_BITS.right
  if (input.weaponPrimary) buttons |= PLAYER_INPUT_BUTTON_BITS.weaponPrimary
  if (input.weaponSecondary) buttons |= PLAYER_INPUT_BUTTON_BITS.weaponSecondary
  return buttons
}

/**
 * Encodes one or more contiguous fixed-tick inputs with identical held state.
 *
 * @param input - First canonical input payload covered by the run.
 * @param toSeq - Final sequence covered by this run.
 * @returns Compact command-run payload for protocol v2 transport.
 */
export function encodePlayerInputStateRun(
  input: PlayerInputPayload,
  toSeq = input.seq,
): PlayerInputCommandRunPayload {
  return {
    fromSeq: input.seq,
    toSeq,
    clientSendTimeMs: input.clientSendTimeMs,
    buttons: playerInputButtonsFromPayload(input),
    targetX: input.weaponTargetX,
    targetY: input.weaponTargetY,
    ...(input.abilitySlot !== null ? { abilitySlot: input.abilitySlot } : {}),
    ...(input.useQuickItemSlot !== null
      ? { useQuickItemSlot: input.useQuickItemSlot }
      : {}),
  }
}

/**
 * Decodes one sequence from a protocol v2 command run into the canonical input.
 *
 * @param run - Compact command run covering the requested sequence.
 * @param seq - Sequence to materialize for authoritative simulation.
 * @returns Canonical full player input payload for one simulation tick.
 */
export function decodePlayerInputStateRun(
  run: PlayerInputCommandRunPayload,
  seq: number,
): PlayerInputPayload {
  return {
    up: hasButton(run.buttons, PLAYER_INPUT_BUTTON_BITS.up),
    down: hasButton(run.buttons, PLAYER_INPUT_BUTTON_BITS.down),
    left: hasButton(run.buttons, PLAYER_INPUT_BUTTON_BITS.left),
    right: hasButton(run.buttons, PLAYER_INPUT_BUTTON_BITS.right),
    abilitySlot: run.abilitySlot ?? null,
    abilityTargetX: run.targetX,
    abilityTargetY: run.targetY,
    weaponPrimary: hasButton(run.buttons, PLAYER_INPUT_BUTTON_BITS.weaponPrimary),
    weaponSecondary: hasButton(run.buttons, PLAYER_INPUT_BUTTON_BITS.weaponSecondary),
    weaponTargetX: run.targetX,
    weaponTargetY: run.targetY,
    useQuickItemSlot: run.useQuickItemSlot ?? null,
    seq,
    clientSendTimeMs: run.clientSendTimeMs,
  }
}

/**
 * Returns whether a compact button mask contains a bit.
 *
 * @param buttons - Compact button mask.
 * @param bit - Button bit to test.
 * @returns True when the bit is present.
 */
function hasButton(buttons: number, bit: number): boolean {
  return (buttons & bit) !== 0
}
