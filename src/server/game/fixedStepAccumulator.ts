export type FixedStepAccumulatorAdvance = {
  readonly steps: number
  readonly accumulatorMs: number
  readonly droppedDebtMs: number
}

/**
 * Advances a capped fixed-step accumulator by one elapsed-time sample.
 *
 * @param options - Current accumulator state, elapsed time, fixed-step size, and cap.
 * @returns The number of whole fixed steps to run, residual accumulator, and discarded debt.
 */
export function advanceFixedStepAccumulator(options: {
  readonly accumulatorMs: number
  readonly elapsedMs: number
  readonly stepMs: number
  readonly maxCatchUpSteps: number
}): FixedStepAccumulatorAdvance {
  if (
    !Number.isFinite(options.elapsedMs) ||
    options.elapsedMs <= 0 ||
    !Number.isFinite(options.stepMs) ||
    options.stepMs <= 0
  ) {
    return {
      steps: 0,
      accumulatorMs: options.accumulatorMs,
      droppedDebtMs: 0,
    }
  }

  const maxSteps = Math.max(1, Math.floor(options.maxCatchUpSteps))
  const maxDebtMs = options.stepMs * maxSteps
  const rawDebtMs = Math.max(0, options.accumulatorMs) + options.elapsedMs
  const droppedDebtMs = Math.max(0, rawDebtMs - maxDebtMs)
  const cappedDebtMs = rawDebtMs - droppedDebtMs
  const steps = Math.min(maxSteps, Math.floor(cappedDebtMs / options.stepMs))
  const accumulatorMs = cappedDebtMs - steps * options.stepMs

  return {
    steps,
    accumulatorMs,
    droppedDebtMs,
  }
}
