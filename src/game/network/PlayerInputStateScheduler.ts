import {
  MAX_PLAYER_INPUT_COMMAND_RUNS_PER_BATCH,
  MAX_PLAYER_INPUT_COMMAND_RUN_SPAN_TICKS,
  encodePlayerInputStateRun,
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
  private pendingRuns: PlayerInputCommandRunPayload[] = []
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
    this.pendingRuns = []
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
    const edge = input.abilitySlot !== null || input.useQuickItemSlot !== null
    const currentRun = encodePlayerInputStateRun(input)
    let forceFlush = false

    const pendingRun = this.pendingRuns[this.pendingRuns.length - 1]
    if (pendingRun === undefined) {
      this.pendingRuns.push(currentRun)
      forceFlush = edge || this.hasButtonStateChangedSinceLastSent(currentRun)
    } else if (canExtendRun(pendingRun, currentRun)) {
      this.pendingRuns[this.pendingRuns.length - 1] = {
        ...pendingRun,
        toSeq: input.seq,
      }
    } else {
      const freshAction =
        edge ||
        currentRun.buttons !== 0 ||
        this.hasButtonStateChangedSinceLastSent(currentRun)
      if (freshAction) {
        this.pendingRuns = this.pendingRuns.filter((run) => !isTargetOnlyRun(run))
      } else if (isNoOpIdleRun(pendingRun, this.lastSentTarget)) {
        this.pendingRuns.pop()
      }
      this.pendingRuns.push(currentRun)
      forceFlush = edge || this.hasButtonStateChangedSinceLastSent(currentRun)
    }

    const latestPendingRun = this.pendingRuns[this.pendingRuns.length - 1]
    if (latestPendingRun === undefined) return null
    const pendingSpan =
      latestPendingRun.toSeq - latestPendingRun.fromSeq + 1
    const runFull = pendingSpan >= MAX_PLAYER_INPUT_COMMAND_RUN_SPAN_TICKS
    const batchFull =
      this.pendingRuns.length >= MAX_PLAYER_INPUT_COMMAND_RUNS_PER_BATCH
    const heartbeatMs = this.pendingRuns.some((run) =>
      this.needsActiveHeartbeat(run),
    )
      ? this.activeHeartbeatMs
      : this.idleHeartbeatMs
    const due =
      this.lastSentAtMs === null ||
      nowMs - this.lastSentAtMs >= heartbeatMs - Number.EPSILON

    if (!forceFlush && !edge && !due && !runFull && !batchFull) return null

    const runs = this.pendingRuns
    this.pendingRuns = []
    this.lastSentAtMs = nowMs
    const lastRun = runs[runs.length - 1]
    this.lastSentButtons = lastRun.buttons
    this.lastSentTarget = { x: lastRun.targetX, y: lastRun.targetY }
    return { protocolVersion: 2, runs }
  }

  /**
   * Returns whether a fresh pending run changes the last flushed button state.
   *
   * @param run - Singleton run for the newest tick.
   * @returns True when the command state should be sent immediately.
   */
  private hasButtonStateChangedSinceLastSent(
    run: PlayerInputCommandRunPayload,
  ): boolean {
    return this.lastSentButtons !== null && run.buttons !== this.lastSentButtons
  }

  /**
   * Returns whether a run should be sent on the active compact heartbeat cadence.
   *
   * @param run - Pending compact run.
   * @returns True for held buttons, edges, or target updates.
   */
  private needsActiveHeartbeat(run: PlayerInputCommandRunPayload): boolean {
    return (
      run.buttons !== 0 ||
      run.abilitySlot !== undefined ||
      run.useQuickItemSlot !== undefined ||
      (this.lastSentTarget !== null &&
        (run.targetX !== this.lastSentTarget.x ||
          run.targetY !== this.lastSentTarget.y))
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
function isNoOpIdleRun(
  run: PlayerInputCommandRunPayload,
  lastSentTarget: { readonly x: number; readonly y: number } | null,
): boolean {
  return (
    run.buttons === 0 &&
    run.abilitySlot === undefined &&
    run.useQuickItemSlot === undefined &&
    lastSentTarget !== null &&
    run.targetX === lastSentTarget.x &&
    run.targetY === lastSentTarget.y
  )
}

/**
 * Returns whether a compact run only updates cursor/aim state.
 *
 * @param run - Compact command run to inspect.
 * @returns True when no held button or edge command depends on the run.
 */
function isTargetOnlyRun(run: PlayerInputCommandRunPayload): boolean {
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
