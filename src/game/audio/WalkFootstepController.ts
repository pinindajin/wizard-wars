import { ClientPlayerState } from "../ecs/components"
import {
  SFX_KEYS,
  WALK_FOOTSTEP_INTERVAL_MS,
} from "@/shared/balance-config/audio"
import { tickWalkFootstepAccumulator } from "@/shared/balance-config/walkFootstepTimer"
import type { MoveIntent } from "@/shared/movementIntent"
import { normalizedMoveFromWASD } from "@/shared/movementIntent"
import type { SoundManager } from "./SoundManager"

/** Volume multiplier for walk steps relative to master SFX (0–1). */
const WALK_STEP_VOLUME = 0.7

/**
 * Drives local-only walk footstep one-shots on a fixed cadence while light gates pass.
 */
export class WalkFootstepController {
  private accumMs = 0

  /**
   * @param soundManager - Arena SFX manager.
   * @param getLocalPlayerId - Returns Colyseus player id for this client, or null.
   */
  constructor(
    private readonly soundManager: SoundManager,
    private readonly getLocalPlayerId: () => string | null,
  ) {}

  /**
   * Call once per frame after player state has been updated for this tick.
   *
   * @param deltaMs - Phaser frame delta in ms.
   * @param moveIntent - Current WASD sample from the keyboard controller.
   */
  tick(deltaMs: number, moveIntent: MoveIntent): void {
    const localId = this.getLocalPlayerId()
    const state = localId ? findClientStateByPlayerId(localId) : null
    const active = localWalkFootstepGatesPass(moveIntent, state)

    const { nextAccumMs, fireStep } = tickWalkFootstepAccumulator(
      this.accumMs,
      deltaMs,
      active,
      WALK_FOOTSTEP_INTERVAL_MS,
    )
    this.accumMs = nextAccumMs
    if (fireStep) {
      this.soundManager.play(SFX_KEYS.walkStep, WALK_STEP_VOLUME)
    }
  }

  /**
   * Clears timing state (e.g. when leaving the arena). Prevents carry-over bursts.
   */
  reset(): void {
    this.accumMs = 0
  }
}

/**
 * Returns whether the normative “light gates” allow walk footsteps for the local player.
 *
 * @param moveIntent - Keyboard movement intent.
 * @param state - Local player's {@link ClientPlayerState} row, or null if missing.
 * @returns True when footsteps should advance their repeat timer.
 */
export function localWalkFootstepGatesPass(
  moveIntent: MoveIntent,
  state: (typeof ClientPlayerState)[number] | null,
): boolean {
  if (!state) return false
  const { dx, dy } = normalizedMoveFromWASD(moveIntent)
  if (dx === 0 && dy === 0) return false
  if (state.animState === "dying" || state.animState === "dead") return false
  if (state.moveState === "rooted") return false
  if ((state.jumpZ ?? 0) > 0) return false
  return true
}

/**
 * Looks up the client player state record for a given network player id.
 *
 * @param playerId - Colyseus / room player id.
 * @returns The state object or null if not found.
 */
export function findClientStateByPlayerId(
  playerId: string,
): (typeof ClientPlayerState)[number] | null {
  for (const s of Object.values(ClientPlayerState)) {
    if (s.playerId === playerId) return s
  }
  return null
}
