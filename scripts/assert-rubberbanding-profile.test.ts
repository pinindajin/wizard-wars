import { describe, expect, it, vi } from "vitest"

import {
  assertRubberbandingProfile,
  isAssertCliEntrypoint,
  parseAssertArgs,
  runAssertRubberbandingProfile,
  type RubberbandingAssertResult,
} from "./assert-rubberbanding-profile"
import type { RubberbandingProfileReport } from "./profile-rubberbanding"

function report(
  overrides: Partial<RubberbandingProfileReport["scenarios"][number]> = {},
): RubberbandingProfileReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-19T00:00:00.000Z",
    phase: "phase-test",
    commit: "abc123",
    seed: 42,
    warmupTicks: 10,
    sampleCount: 100,
    scenarios: [
      {
        scenario: "remote-interpolation",
        metrics: [
          { name: "extrapolatedFrameRatio", unit: "ratio", value: 0.2 },
          { name: "p99ExtrapolationMs", unit: "ms", value: 20 },
        ],
        network: { bytes: 0, messages: 0 },
        ...overrides,
      },
    ],
    costs: [],
    provenance: [],
  }
}

describe("rubberbanding profile assertions", () => {
  it("passes when after metrics meet absolute and relative thresholds", () => {
    const result = assertRubberbandingProfile({
      baseline: report(),
      after: report({
        metrics: [
          { name: "extrapolatedFrameRatio", unit: "ratio", value: 0.01 },
          { name: "p99ExtrapolationMs", unit: "ms", value: 7 },
        ],
      }),
    })

    expect(result).toEqual<RubberbandingAssertResult>({
      ok: true,
      failures: [],
    })
  })

  it("fails when after metrics do not improve enough", () => {
    const result = assertRubberbandingProfile({
      baseline: report(),
      after: report({
        metrics: [
          { name: "extrapolatedFrameRatio", unit: "ratio", value: 0.08 },
          { name: "p99ExtrapolationMs", unit: "ms", value: 9 },
        ],
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContain(
      "remote-interpolation extrapolatedFrameRatio expected <= 0.0200, got 0.0800",
    )
    expect(result.failures).toContain(
      "remote-interpolation p99ExtrapolationMs expected <= 8.0000, got 9.0000",
    )
  })

  it("fails when a scenario exists only on one side of the comparison", () => {
    const result = assertRubberbandingProfile({
      baseline: report({ scenario: "remote-interpolation" }),
      after: report({ scenario: "owner-ack" }),
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toEqual([
      "missing after scenario: remote-interpolation",
      "missing baseline scenario: owner-ack",
    ])
  })

  it("applies every phase acceptance threshold", () => {
    const baseline = fullReport({
      "owner-ack": { snapOver2PxCount: 100 },
      "server-loop-catch-up": {
        simulatedDriftMsAfter100MsStall: 83.33,
        droppedDebtMs: 83.33,
        tickDeficitAfter100MsStall: 5,
      },
      "world-collision": { worldCollisionP95Ms: 10, worldCollisionP99Ms: 20 },
      "homing-orb-pressure": { homingOrbBurstBytes: 10_000 },
      "input-bandwidth": {
        idleInputMessagesPerSecond: 60,
        idleInputBytesPerSecond: 6_000,
        transitionAckLatencyMs: 80,
      },
      "swift-boots": { swiftBootsPredictionSnapPx: 12 },
    })
    const after = fullReport({
      "owner-ack": { snapOver2PxCount: 51 },
      "server-loop-catch-up": {
        simulatedDriftMsAfter100MsStall: 2,
        droppedDebtMs: 1,
        tickDeficitAfter100MsStall: 1,
      },
      "world-collision": { worldCollisionP95Ms: 8, worldCollisionP99Ms: 15 },
      "homing-orb-pressure": { homingOrbBurstBytes: 7_000 },
      "input-bandwidth": {
        idleInputMessagesPerSecond: 7,
        idleInputBytesPerSecond: 700,
        transitionAckLatencyMs: 101,
      },
      "swift-boots": { swiftBootsPredictionSnapPx: 1 },
    })

    expect(assertRubberbandingProfile({ baseline, after }).failures).toEqual([
      "owner-ack snapOver2PxCount expected <= 50.0000, got 51.0000",
      "server-loop-catch-up simulatedDriftMsAfter100MsStall expected <= 1.0000, got 2.0000",
      "server-loop-catch-up droppedDebtMs expected <= 0.0000, got 1.0000",
      "server-loop-catch-up tickDeficitAfter100MsStall expected <= 0.0000, got 1.0000",
      "world-collision worldCollisionP95Ms expected <= 7.0000, got 8.0000",
      "world-collision worldCollisionP99Ms expected <= 14.0000, got 15.0000",
      "homing-orb-pressure homingOrbBurstBytes expected <= 6000.0000, got 7000.0000",
      "input-bandwidth idleInputMessagesPerSecond expected <= 6.0000, got 7.0000",
      "input-bandwidth idleInputBytesPerSecond expected <= 600.0000, got 700.0000",
      "input-bandwidth transitionAckLatencyMs expected <= 100.0000, got 101.0000",
      "swift-boots swiftBootsPredictionSnapPx expected <= 0.0000, got 1.0000",
    ])
  })

  it("applies only the active fix threshold for numbered phase profiles", () => {
    const baseline = fullReport({
      "remote-interpolation": {
        extrapolatedFrameRatio: 0.2,
        p99ExtrapolationMs: 20,
      },
      "owner-ack": { snapOver2PxCount: 100 },
    })
    const after = fullReport(
      {
        "remote-interpolation": {
          extrapolatedFrameRatio: 0.01,
          p99ExtrapolationMs: 4,
        },
        "owner-ack": { snapOver2PxCount: 100 },
      },
      "phase-1-after",
    )

    expect(assertRubberbandingProfile({ baseline, after })).toEqual({
      ok: true,
      failures: [],
    })
  })

  it("applies the server loop catch-up threshold for phase 3 profiles", () => {
    const baseline = fullReport({
      "server-loop-catch-up": {
        simulatedDriftMsAfter100MsStall: 83.33,
        droppedDebtMs: 83.33,
        tickDeficitAfter100MsStall: 5,
      },
    })
    const after = fullReport(
      {
        "server-loop-catch-up": {
          simulatedDriftMsAfter100MsStall: 83.33,
          droppedDebtMs: 83.33,
          tickDeficitAfter100MsStall: 5,
        },
      },
      "phase-3-after",
    )

    expect(assertRubberbandingProfile({ baseline, after }).failures).toEqual([
      "server-loop-catch-up simulatedDriftMsAfter100MsStall expected <= 1.0000, got 83.3300",
      "server-loop-catch-up droppedDebtMs expected <= 0.0000, got 83.3300",
      "server-loop-catch-up tickDeficitAfter100MsStall expected <= 0.0000, got 5.0000",
    ])
  })

  it("skips thresholds for numbered phases that are intentionally ungated", () => {
    const baseline = fullReport({
      "remote-interpolation": {
        extrapolatedFrameRatio: 0.2,
        p99ExtrapolationMs: 20,
      },
    })
    const after = fullReport(
      {
        "remote-interpolation": {
          extrapolatedFrameRatio: 0.2,
          p99ExtrapolationMs: 20,
        },
      },
      "phase-99-after",
    )

    expect(assertRubberbandingProfile({ baseline, after })).toEqual({
      ok: true,
      failures: [],
    })
  })

  it("ignores thresholds whose metric rows are missing from otherwise matching scenarios", () => {
    const baseline = report({ metrics: [] })
    const after = report({ metrics: [] })

    expect(assertRubberbandingProfile({ baseline, after })).toEqual({
      ok: false,
      failures: [
        "remote-interpolation missing baseline metric: extrapolatedFrameRatio",
        "remote-interpolation missing after metric: extrapolatedFrameRatio",
        "remote-interpolation missing baseline metric: p99ExtrapolationMs",
        "remote-interpolation missing after metric: p99ExtrapolationMs",
      ],
    })
  })
})

describe("rubberbanding assertion CLI", () => {
  it("parses required baseline and after paths", () => {
    expect(parseAssertArgs(["--baseline", "/tmp/before.json", "--after", "/tmp/after.json"])).toEqual({
      baselinePath: "/tmp/before.json",
      afterPath: "/tmp/after.json",
    })
  })

  it("requires both baseline and after paths", () => {
    expect(() => parseAssertArgs(["--baseline", "/tmp/before.json"])).toThrow(
      "usage: assert-rubberbanding-profile --baseline <path> --after <path>",
    )
  })

  it("rejects flags that are present without values", () => {
    expect(() => parseAssertArgs(["--baseline", "/tmp/before.json", "--after"])).toThrow(
      "usage: assert-rubberbanding-profile --baseline <path> --after <path>",
    )
  })

  it("returns zero and logs when profile assertions pass", () => {
    const passing = report({
      metrics: [
        { name: "extrapolatedFrameRatio", unit: "ratio", value: 0.01 },
        { name: "p99ExtrapolationMs", unit: "ms", value: 7 },
      ],
    })
    const readFile = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(report()))
      .mockReturnValueOnce(JSON.stringify(passing))
    const log = vi.fn()

    expect(
      runAssertRubberbandingProfile(["--baseline", "/tmp/before.json", "--after", "/tmp/after.json"], {
        readFile,
        log,
        error: vi.fn(),
      }),
    ).toBe(0)
    expect(log).toHaveBeenCalledWith("rubberbanding profile assertions passed")
  })

  it("returns one and logs threshold failures", () => {
    const readFile = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(report()))
      .mockReturnValueOnce(
        JSON.stringify(
          report({
            metrics: [
              { name: "extrapolatedFrameRatio", unit: "ratio", value: 0.2 },
              { name: "p99ExtrapolationMs", unit: "ms", value: 20 },
            ],
          }),
        ),
      )
    const error = vi.fn()

    expect(
      runAssertRubberbandingProfile(["--baseline", "/tmp/before.json", "--after", "/tmp/after.json"], {
        readFile,
        log: vi.fn(),
        error,
      }),
    ).toBe(1)
    expect(error).toHaveBeenCalledWith(
      "remote-interpolation extrapolatedFrameRatio expected <= 0.0200, got 0.2000",
    )
  })

  it("reports parse failures", () => {
    const error = vi.fn()

    expect(
      runAssertRubberbandingProfile([], {
        readFile: vi.fn(),
        log: vi.fn(),
        error,
      }),
    ).toBe(1)
    expect(error).toHaveBeenCalledWith("rubberbanding profile assertion failed")
    expect(error).toHaveBeenCalledWith(
      "usage: assert-rubberbanding-profile --baseline <path> --after <path>",
    )
  })

  it("detects the assertion CLI entrypoint", () => {
    const scriptPath = "/repo/scripts/assert-rubberbanding-profile.ts"

    expect(isAssertCliEntrypoint(["bun", scriptPath], `file://${scriptPath}`)).toBe(true)
    expect(isAssertCliEntrypoint(["bun"], `file://${scriptPath}`)).toBe(false)
  })
})

function fullReport(
  metricValues: Record<string, Record<string, number>>,
  phase = "phase-test",
): RubberbandingProfileReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-19T00:00:00.000Z",
    phase,
    commit: "abc123",
    seed: 42,
    warmupTicks: 10,
    sampleCount: 100,
    scenarios: Object.entries(metricValues).map(([scenario, values]) => ({
      scenario: scenario as RubberbandingProfileReport["scenarios"][number]["scenario"],
      metrics: Object.entries(values).map(([name, value]) => ({ name, unit: "unit", value })),
      network: { bytes: 0, messages: 0 },
    })),
    costs: [],
    provenance: [],
  }
}
