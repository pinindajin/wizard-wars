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
      "world-collision": { worldCollisionP95Ms: 10 },
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
      "world-collision": { worldCollisionP95Ms: 8 },
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
      "world-collision worldCollisionP95Ms expected <= 7.0000, got 8.0000",
      "homing-orb-pressure homingOrbBurstBytes expected <= 6000.0000, got 7000.0000",
      "input-bandwidth idleInputMessagesPerSecond expected <= 6.0000, got 7.0000",
      "input-bandwidth idleInputBytesPerSecond expected <= 600.0000, got 700.0000",
      "input-bandwidth transitionAckLatencyMs expected <= 100.0000, got 101.0000",
      "swift-boots swiftBootsPredictionSnapPx expected <= 0.0000, got 1.0000",
    ])
  })

  it("ignores thresholds whose metric rows are missing from otherwise matching scenarios", () => {
    const baseline = report({ metrics: [] })
    const after = report({ metrics: [] })

    expect(assertRubberbandingProfile({ baseline, after })).toEqual({
      ok: true,
      failures: [],
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
): RubberbandingProfileReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-19T00:00:00.000Z",
    phase: "phase-test",
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
