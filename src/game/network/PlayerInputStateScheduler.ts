import {
  MAX_PLAYER_INPUT_COMMAND_RUN_SPAN_TICKS,
  encodePlayerInputStateRun,
  playerInputButtonsFromPayload,
} from "@/shared/playerInputState"
import type {
  PlayerInputCommandRunPayload,
  PlayerInputPayload,
  PlayerInputStatePayload,
} from "@/shared/types"

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
  private lastSentAtMs: number | null = null
  private lastSentButtons: number | null = null
  private lastSentTarget: { readonly x: number; readonly y: number } | null = null
  private pendingRun: PlayerInputCommandRunPayload | null = null
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
    this.lastSentAtMs = null
    this.lastSentButtons = null
    this.lastSentTarget = null
    this.pendingRun = null
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
    const heartbeatMs = active ? this.activeHeartbeatMs : this.idleHeartbeatMs
    const due =
      this.lastSentAtMs === null ||
      nowMs - this.lastSentAtMs >= heartbeatMs - Number.EPSILON
    const currentRun = encodePlayerInputStateRun(input)
    const runs: PlayerInputCommandRunPayload[] = []
    let forceFlush = false

    if (this.pendingRun === null) {
      this.pendingRun = currentRun
      forceFlush = this.hasChangedSinceLastSent(currentRun)
    } else if (canExtendRun(this.pendingRun, currentRun)) {
      this.pendingRun = { ...this.pendingRun, toSeq: input.seq }
    } else {
      if (!isNoOpIdleRun(this.pendingRun)) runs.push(this.pendingRun)
      this.pendingRun = currentRun
      forceFlush = true
    }

    const pendingSpan =
      this.pendingRun.toSeq - this.pendingRun.fromSeq + 1
    const runFull = pendingSpan >= MAX_PLAYER_INPUT_COMMAND_RUN_SPAN_TICKS

    if (!forceFlush && !edge && !due && !runFull) return null

    runs.push(this.pendingRun)
    this.pendingRun = null
    this.lastSentAtMs = nowMs
    const lastRun = runs[runs.length - 1]
    this.lastSentButtons = lastRun.buttons
    this.lastSentTarget = { x: lastRun.targetX, y: lastRun.targetY }
    return { protocolVersion: 2, runs }
  }

  /**
   * Returns whether a fresh pending run differs from the last flushed command.
   *
   * @param run - Singleton run for the newest tick.
   * @returns True when the command state should be sent immediately.
   */
  private hasChangedSinceLastSent(run: PlayerInputCommandRunPayload): boolean {
    return (
      this.lastSentButtons !== null &&
      (run.buttons !== this.lastSentButtons ||
        run.targetX !== this.lastSentTarget?.x ||
        run.targetY !== this.lastSentTarget?.y)
    )
  }
}

/**
 * Returns whether a pending command run may absorb the next local input tick.
 *
 * @param pending - Current unsent command run.
 * @param next - Singleton command run for the newest local tick.
 * @returns True when the run keeps exact command semantics.
 */
function canExtendRun(
  pending: PlayerInputCommandRunPayload,
  next: PlayerInputCommandRunPayload,
): boolean {
  const nextHasEdge =
    next.abilitySlot !== undefined || next.useQuickItemSlot !== undefined
  return (
    !nextHasEdge &&
    pending.toSeq + 1 === next.fromSeq &&
    pending.buttons === next.buttons &&
    pending.targetX === next.targetX &&
    pending.targetY === next.targetY &&
    pending.abilitySlot === undefined &&
    pending.useQuickItemSlot === undefined
  )
}

/**
 * Returns whether a run has no authoritative gameplay effect by itself.
 *
 * @param run - Compact command run to inspect.
 * @returns True when the run only repeats idle/no-edge state.
 */
function isNoOpIdleRun(run: PlayerInputCommandRunPayload): boolean {
  return (
    run.buttons === 0 &&
    run.abilitySlot === undefined &&
    run.useQuickItemSlot === undefined
  )
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
