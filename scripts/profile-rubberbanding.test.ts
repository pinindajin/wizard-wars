import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { describe, expect, it, vi } from "vitest"

import {
  RUBBERBANDING_SCENARIOS,
  buildRubberbandingProfileReport,
  classifyRubberbandingCause,
  isProfileCliEntrypoint,
  parseProfileArgs,
  runProfileRubberbanding,
} from "./profile-rubberbanding"

describe("rubberbanding profile report", () => {
  it("builds a deterministic report with all required scenarios and metadata", () => {
    const report = buildRubberbandingProfileReport({
      phase: "phase-0",
      commit: "abc123",
      seed: 42,
      warmupTicks: 12,
      sampleCount: 120,
    })

    expect(report.phase).toBe("phase-0")
    expect(report.commit).toBe("abc123")
    expect(report.seed).toBe(42)
    expect(report.warmupTicks).toBe(12)
    expect(report.sampleCount).toBe(120)
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(report.scenarios.map((scenario) => scenario.scenario)).toEqual(
      RUBBERBANDING_SCENARIOS,
    )
    expect(report.scenarios.every((scenario) => scenario.metrics.length > 0)).toBe(true)
    expect(report.scenarios.every((scenario) => scenario.network.messages >= 0)).toBe(true)
    expect(report.scenarios.every((scenario) => scenario.network.bytes >= 0)).toBe(true)
  })

  it("includes the primary game-loop CPU and network cost rows", () => {
    const report = buildRubberbandingProfileReport({
      phase: "phase-0",
      commit: "abc123",
    })

    expect(report.costs).toEqual([
      {
        behavior: "input queue",
        cpuCost: "O(players + queued inputs) per tick; validates and keeps one canonical input per player",
        networkCost: "Inbound player input messages; compact transport should lower idle messages",
      },
      {
        behavior: "simulation tick",
        cpuCost:
          "O(players + projectiles + active effects + static-collision candidates) per fixed 60Hz tick",
        networkCost: "No direct network cost; produces authoritative deltas/events for batching",
      },
      {
        behavior: "movement",
        cpuCost: "O(players) with shared fixed-step movement and terrain/collision probes",
        networkCost: "Indirect player position/velocity delta cost when state changes",
      },
      {
        behavior: "world collision",
        cpuCost:
          "O(players * nearby static collider candidates), with brute-force fallback for deep overlaps",
        networkCost: "No direct network cost",
      },
      {
        behavior: "projectile movement",
        cpuCost: "O(projectiles + homing orbs * target candidates) per tick",
        networkCost: "Indirect projectile delta cost",
      },
      {
        behavior: "projectile collision",
        cpuCost:
          "O(projectiles * damageable players) unless candidate caches/broadphase reduce checks",
        networkCost: "Impact/removal events when collisions or expiries resolve",
      },
      {
        behavior: "projectile delta",
        cpuCost: "O(active projectiles) to compare previous authoritative state",
        networkCost: "Outbound fireball/Homing Orb batch deltas and removals",
      },
      {
        behavior: "network batching",
        cpuCost: "O(pending deltas) per visual flush",
        networkCost: "Outbound explicit RoomEvent batches at WW_NET_SEND_RATE_HZ",
      },
      {
        behavior: "owner ACKs",
        cpuCost: "O(local player deltas with processed seq) per tick",
        networkCost:
          "Owner-only replay context payloads; target budget < 10KiB/sec/player growth",
      },
      {
        behavior: "player batches",
        cpuCost: "O(changed players) per visual flush",
        networkCost: "Outbound player visual batch payloads to all room clients",
      },
      {
        behavior: "Homing Orb batches",
        cpuCost: "O(changed homing orbs) per visual flush",
        networkCost:
          "Outbound Homing Orb deltas/removals; compact deltas should reduce burst bytes",
      },
      {
        behavior: "compact input",
        cpuCost: "O(1) encode/decode per state message",
        networkCost:
          "Inbound state-change and heartbeat messages instead of 60Hz full idle payloads",
      },
    ])
  })

  it("uses deterministic defaults when optional profile settings are omitted", () => {
    const report = buildRubberbandingProfileReport({
      phase: "phase-0",
      commit: "abc123",
      generatedAt: "2026-06-19T00:00:00.000Z",
    })

    expect(report).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-06-19T00:00:00.000Z",
      seed: 7,
      warmupTicks: 60,
      sampleCount: 600,
    })
  })

  it("falls back when seed is explicitly undefined from untyped CLI input", () => {
    const report = buildRubberbandingProfileReport({
      phase: "phase-0",
      commit: "abc123",
      seed: undefined,
      generatedAt: "2026-06-19T00:00:00.000Z",
    })

    expect(report.seed).toBe(7)
  })

  it("models the Fix 1 remote interpolation timing improvement in after profiles", () => {
    const before = buildRubberbandingProfileReport({
      phase: "phase-1-before",
      commit: "abc123",
      generatedAt: "2026-06-19T00:00:00.000Z",
    })
    const after = buildRubberbandingProfileReport({
      phase: "phase-1-after",
      commit: "abc123",
      generatedAt: "2026-06-19T00:00:00.000Z",
    })

    const beforeRemote = before.scenarios.find((scenario) => scenario.scenario === "remote-interpolation")
    const afterRemote = after.scenarios.find((scenario) => scenario.scenario === "remote-interpolation")
    expect(metricValue(afterRemote, "extrapolatedFrameRatio")).toBeLessThanOrEqual(
      metricValue(beforeRemote, "extrapolatedFrameRatio") * 0.1,
    )
    expect(metricValue(afterRemote, "p99ExtrapolationMs")).toBeLessThanOrEqual(8)
    expect(metricValue(afterRemote, "netSendIntervalMs")).toBeCloseTo(1000 / 30, 5)
    expect(metricValue(afterRemote, "remoteRenderDelayMs")).toBe(84)
  })

})

describe("rubberbanding cause provenance", () => {
  it("classifies causes with an explicit origin and evidence", () => {
    expect(
      classifyRubberbandingCause({
        cause: "30Hz visual batching under-buffered",
        introducedBy: "PR #100",
        evidence: ["DEFAULT_NET_SEND_RATE_HZ = 30"],
      }),
    ).toEqual({
      cause: "30Hz visual batching under-buffered",
      origin: "recent-pr",
      introducedBy: "PR #100",
      evidence: ["DEFAULT_NET_SEND_RATE_HZ = 30"],
    })

    expect(
      classifyRubberbandingCause({
        cause: "Swift Boots client prediction mismatch",
        introducedBy: null,
        evidence: ["hasSwiftBoots missing from PlayerSnapshot"],
      }).origin,
    ).toBe("pre-existing")
  })
})

function metricValue(
  scenario: { readonly metrics: readonly { readonly name: string; readonly value: number }[] } | undefined,
  name: string,
): number {
  const value = scenario?.metrics.find((metric) => metric.name === name)?.value
  if (value === undefined) throw new Error(`missing metric ${name}`)
  return value
}

describe("rubberbanding profile CLI", () => {
  it("parses explicit profile arguments", () => {
    expect(
      parseProfileArgs([
        "--phase",
        "phase-1",
        "--commit",
        "abc123",
        "--seed",
        "5",
        "--warmup-ticks",
        "10",
        "--sample-count",
        "20",
        "--json",
        "/tmp/out.json",
      ]),
    ).toEqual({
      phase: "phase-1",
      commit: "abc123",
      seed: 5,
      warmupTicks: 10,
      sampleCount: 20,
      jsonPath: "/tmp/out.json",
    })
  })

  it("treats flags without values as absent", () => {
    expect(parseProfileArgs(["--phase"])).toMatchObject({
      phase: "phase-0",
      commit: null,
      jsonPath: null,
    })
  })

  it("writes profile JSON when an output path is provided", () => {
    const writeFile = vi.fn()
    const log = vi.fn()
    const error = vi.fn()

    expect(
      runProfileRubberbanding(["--json", "/tmp/profile.json"], {
        commit: "from-deps",
        writeFile,
        log,
        error,
      }),
    ).toBe(0)
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/profile.json",
      expect.stringContaining('"commit": "from-deps"'),
    )
    expect(log).toHaveBeenCalledWith("wrote rubberbanding profile: /tmp/profile.json")
    expect(error).not.toHaveBeenCalled()
  })

  it("logs profile JSON when no output path is provided", () => {
    const log = vi.fn()

    expect(
      runProfileRubberbanding([], {
        commit: "from-deps",
        writeFile: vi.fn(),
        log,
        error: vi.fn(),
      }),
    ).toBe(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"phase": "phase-0"'))
  })

  it("reports profile write failures", () => {
    const error = vi.fn()

    expect(
      runProfileRubberbanding(["--json", "/tmp/profile.json"], {
        commit: "from-deps",
        writeFile: () => {
          throw new Error("disk full")
        },
        log: vi.fn(),
        error,
      }),
    ).toBe(1)
    expect(error).toHaveBeenCalledWith("rubberbanding profile failed")
    expect(error).toHaveBeenCalledWith("disk full")
  })

  it("detects the profile CLI entrypoint", () => {
    const scriptPath = "/repo/scripts/profile-rubberbanding.ts"

    expect(isProfileCliEntrypoint(["bun", scriptPath], `file://${scriptPath}`)).toBe(true)
    expect(isProfileCliEntrypoint(["bun"], `file://${scriptPath}`)).toBe(false)
  })

  it("runs as a direct Bun CLI and writes profile JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ww-profile-cli-"))
    const outputPath = join(dir, "profile.json")
    try {
      const result = spawnSync(
        "bun",
        [
          "scripts/profile-rubberbanding.ts",
          "--phase",
          "phase-cli",
          "--commit",
          "abc123",
          "--json",
          outputPath,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe("")
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({
        phase: "phase-cli",
        commit: "abc123",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
