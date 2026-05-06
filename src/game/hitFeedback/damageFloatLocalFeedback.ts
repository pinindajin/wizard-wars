import { HAZARD_TAKE_HIT_SFX_MIN_INTERVAL_MS } from "@/shared/balance-config/combat"
import type { DamageFloatPayload } from "@/shared/types"

/**
 * Decides client-only hit feedback (SFX + who flashes) from a damage float and
 * local player id. Spectators never pass a local id from Arena wiring.
 *
 * @param localPlayerId - Colyseus user id for this client, or null if unset.
 * @param payload - Server damage float payload (includes `attackerUserId`).
 * @param nowMs - Wall clock ms for hazard take-hit throttle.
 * @param lastHazardTakeHitSfxAtMs - Last time hazard take-hit SFX played, or null.
 * @returns Flags for audio/sprites and updated throttle timestamp.
 */
export function resolveDamageFloatLocalFeedback(
  localPlayerId: string | null,
  payload: DamageFloatPayload,
  nowMs: number,
  lastHazardTakeHitSfxAtMs: number | null,
): {
  readonly playDealSfx: boolean
  readonly playTakeHitSfx: boolean
  readonly flashDealerUserId: string | null
  readonly flashVictimUserId: string | null
  readonly nextLastHazardTakeHitSfxAtMs: number | null
} {
  if (!localPlayerId) {
    return {
      playDealSfx: false,
      playTakeHitSfx: false,
      flashDealerUserId: null,
      flashVictimUserId: null,
      nextLastHazardTakeHitSfxAtMs: lastHazardTakeHitSfxAtMs,
    }
  }

  const { targetId, attackerUserId } = payload

  let playDealSfx = false
  let flashDealerUserId: string | null = null
  if (
    attackerUserId !== null &&
    attackerUserId === localPlayerId &&
    attackerUserId !== targetId
  ) {
    playDealSfx = true
    flashDealerUserId = localPlayerId
  }

  let playTakeHitSfx = false
  let flashVictimUserId: string | null = null
  let nextLast = lastHazardTakeHitSfxAtMs

  if (targetId === localPlayerId) {
    flashVictimUserId = localPlayerId
    if (attackerUserId === null) {
      if (
        lastHazardTakeHitSfxAtMs === null ||
        nowMs - lastHazardTakeHitSfxAtMs >= HAZARD_TAKE_HIT_SFX_MIN_INTERVAL_MS
      ) {
        playTakeHitSfx = true
        nextLast = nowMs
      }
    } else {
      playTakeHitSfx = true
    }
  }

  return {
    playDealSfx,
    playTakeHitSfx,
    flashDealerUserId,
    flashVictimUserId,
    nextLastHazardTakeHitSfxAtMs: nextLast,
  }
}
