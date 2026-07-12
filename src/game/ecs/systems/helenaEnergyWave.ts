import type { PrimaryMeleeAttackPayload } from "@/shared/types"

export type HelenaEnergyWaveSpec = {
  readonly delayMs: number
  readonly durationMs: number
  readonly startX: number
  readonly startY: number
  readonly endX: number
  readonly endY: number
  readonly rotation: number
}

/** Converts an authoritative Helena swing into client-only wave motion. */
export function helenaEnergyWaveSpec(
  payload: PrimaryMeleeAttackPayload,
): HelenaEnergyWaveSpec | null {
  if (payload.attackId !== "helena_energy_wave") return null
  const durationMs = Math.max(
    1,
    payload.dangerousWindowEndMs - payload.dangerousWindowStartMs,
  )
  return {
    delayMs: payload.dangerousWindowStartMs,
    durationMs,
    startX: payload.x,
    startY: payload.y,
    endX: payload.x + Math.cos(payload.facingAngle) * payload.hurtboxRadiusPx,
    endY: payload.y + Math.sin(payload.facingAngle) * payload.hurtboxRadiusPx,
    rotation: payload.facingAngle,
  }
}
