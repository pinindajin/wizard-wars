import { describe, expect, it } from "vitest"

import { TICK_MS } from "@/shared/balance-config/rendering"

import { advanceFixedStepAccumulator } from "./fixedStepAccumulator"

describe("advanceFixedStepAccumulator", () => {
  it("carries fractional time until a full fixed step is available", () => {
    const almost = advanceFixedStepAccumulator({
      accumulatorMs: 0,
      elapsedMs: TICK_MS - 0.1,
      stepMs: TICK_MS,
      maxCatchUpSteps: 6,
    })

    expect(almost).toMatchObject({
      steps: 0,
      droppedDebtMs: 0,
    })
    expect(almost.accumulatorMs).toBeCloseTo(TICK_MS - 0.1, 6)

    const crossed = advanceFixedStepAccumulator({
      accumulatorMs: almost.accumulatorMs,
      elapsedMs: 0.2,
      stepMs: TICK_MS,
      maxCatchUpSteps: 6,
    })

    expect(crossed.steps).toBe(1)
    expect(crossed.accumulatorMs).toBeCloseTo(0.1, 6)
    expect(crossed.droppedDebtMs).toBe(0)
  })

  it("runs all missed fixed steps for a normal 100ms stall without dropping debt", () => {
    const result = advanceFixedStepAccumulator({
      accumulatorMs: 0,
      elapsedMs: 100,
      stepMs: TICK_MS,
      maxCatchUpSteps: 6,
    })

    expect(result.steps).toBe(6)
    expect(result.accumulatorMs).toBeCloseTo(0, 6)
    expect(result.droppedDebtMs).toBe(0)
  })

  it("caps extreme stalls and reports only discarded debt as dropped", () => {
    const result = advanceFixedStepAccumulator({
      accumulatorMs: 0,
      elapsedMs: TICK_MS * 10,
      stepMs: TICK_MS,
      maxCatchUpSteps: 3,
    })

    expect(result.steps).toBe(3)
    expect(result.accumulatorMs).toBeCloseTo(0, 6)
    expect(result.droppedDebtMs).toBeCloseTo(TICK_MS * 7, 6)
  })

  it("ignores non-positive or non-finite elapsed time", () => {
    const base = {
      accumulatorMs: 5,
      stepMs: TICK_MS,
      maxCatchUpSteps: 6,
    }

    expect(advanceFixedStepAccumulator({ ...base, elapsedMs: -1 })).toEqual({
      steps: 0,
      accumulatorMs: 5,
      droppedDebtMs: 0,
    })
    expect(advanceFixedStepAccumulator({ ...base, elapsedMs: Number.NaN })).toEqual({
      steps: 0,
      accumulatorMs: 5,
      droppedDebtMs: 0,
    })
  })
})
