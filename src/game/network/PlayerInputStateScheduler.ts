import {
  encodePlayerInputState,
  playerInputButtonsFromPayload,
} from "@/shared/playerInputState"
import type { PlayerInputPayload, PlayerInputStatePayload } from "@/shared/types"

export type PlayerInputStateSchedulerOptions = {
  readonly activeHeartbeatMs?: number
  readonly idleHeartbeatMs?: number
}

const DEFAULT_ACTIVE_HEARTBEAT_MS = 100
const DEFAULT_IDLE_HEARTBEAT_MS = 1_000

/**
 * Decides when a canonical local input tick should be sent over the compact
 * state transport.
 */
export class PlayerInputStateScheduler {
  private lastButtons: number | null = null
  private lastWeaponTarget: { readonly x: number; readonly y: number } | null = null
  private lastSentAtMs: number | null = null
  private activeHeartbeatMs: number
  private idleHeartbeatMs: number

  /**
   * @param options - Optional heartbeat intervals advertised by the server.
   */
  constructor(options: PlayerInputStateSchedulerOptions = {}) {
    this.activeHeartbeatMs = positiveOrDefault(
      options.activeHeartbeatMs,
      DEFAULT_ACTIVE_HEARTBEAT_MS,
    )
    this.idleHeartbeatMs = positiveOrDefault(
      options.idleHeartbeatMs,
      DEFAULT_IDLE_HEARTBEAT_MS,
    )
  }

  /**
   * Resets transport-local state. Call on reconnect or protocol changes so the
   * next canonical input is sent as a fresh baseline.
   */
  reset(): void {
    this.lastButtons = null
    this.lastWeaponTarget = null
    this.lastSentAtMs = null
  }

  /**
   * Returns a compact payload when the input should be sent, otherwise null.
   *
   * @param input - Canonical full local input for the current fixed tick.
   * @param nowMs - Local wall-clock timestamp for heartbeat decisions.
   * @returns Compact input state or null when this tick can be suppressed.
   */
  maybeBuildState(
    input: PlayerInputPayload,
    nowMs: number,
  ): PlayerInputStatePayload | null {
    const buttons = playerInputButtonsFromPayload(input)
    const edge = input.abilitySlot !== null || input.useQuickItemSlot !== null
    const active = buttons !== 0 || edge
    const aimChanged =
      this.lastWeaponTarget === null ||
      input.weaponTargetX !== this.lastWeaponTarget.x ||
      input.weaponTargetY !== this.lastWeaponTarget.y
    const heartbeatMs =
      active || aimChanged ? this.activeHeartbeatMs : this.idleHeartbeatMs
    const changed = this.lastButtons === null || buttons !== this.lastButtons
    const due =
      this.lastSentAtMs === null ||
      nowMs - this.lastSentAtMs >= heartbeatMs - Number.EPSILON

    if (!changed && !edge && !due) return null

    this.lastButtons = buttons
    this.lastWeaponTarget = { x: input.weaponTargetX, y: input.weaponTargetY }
    this.lastSentAtMs = nowMs
    return encodePlayerInputState(input)
  }
}

/**
 * Keeps configured heartbeat values positive and finite.
 *
 * @param value - Candidate interval.
 * @param fallback - Safe default interval.
 * @returns Positive finite interval.
 */
function positiveOrDefault(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback
}
