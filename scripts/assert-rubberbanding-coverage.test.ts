import { describe, expect, it, vi } from "vitest"

import {
  assertChangedLineCoverage,
  parseChangedLineDiff,
  runAssertRubberbandingCoverage,
  type IstanbulCoverageFile,
} from "./assert-rubberbanding-coverage"

describe("parseChangedLineDiff", () => {
  it("collects added line numbers per repository file", () => {
    expect(
      parseChangedLineDiff([
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,3 @@",
        " unchanged",
        "+added",
        "-removed",
        " context",
        "+tail",
      ].join("\n")),
    ).toEqual(new Map([["src/a.ts", new Set([2, 4])]]))
  })

  it("ignores malformed hunk headers", () => {
    expect(
      parseChangedLineDiff([
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ malformed @@",
        "+added",
      ].join("\n")),
    ).toEqual(new Map([["src/a.ts", new Set<number>()]]))
  })
})

describe("assertChangedLineCoverage", () => {
  it("passes when changed lines have no executable coverage entries", () => {
    const result = assertChangedLineCoverage({
      coverageByFile: new Map(),
      changedLinesByFile: new Map([["src/shared/types.ts", new Set([10, 11])]]),
      requiredFiles: ["src/shared/types.ts"],
    })

    expect(result).toEqual({ ok: true, failures: [] })
  })

  it("passes when required files have no changed lines", () => {
    expect(
      assertChangedLineCoverage({
        coverageByFile: new Map(),
        changedLinesByFile: new Map(),
        requiredFiles: ["src/game/foo.ts"],
      }),
    ).toEqual({ ok: true, failures: [] })
    expect(
      assertChangedLineCoverage({
        coverageByFile: new Map(),
        changedLinesByFile: new Map([["src/game/foo.ts", new Set()]]),
        requiredFiles: ["src/game/foo.ts"],
      }),
    ).toEqual({ ok: true, failures: [] })
  })

  it("passes when a changed covered file has no executable entries on that line", () => {
    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverageFile({})]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([12])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result).toEqual({ ok: true, failures: [] })
  })

  it("fails when a changed executable statement is uncovered", () => {
    const coverage = coverageFile({
      statementMap: {
        "0": { start: { line: 3 }, end: { line: 3 } },
      },
      s: { "0": 0 },
    })

    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverage]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([3])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result).toEqual({
      ok: false,
      failures: ["src/game/foo.ts:3 changed statement was not covered"],
    })
  })

  it("treats missing changed statement counters as uncovered", () => {
    const coverage = coverageFile({
      statementMap: {
        "0": { start: { line: 6 }, end: { line: 6 } },
      },
    })

    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverage]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([6])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result.failures).toEqual(["src/game/foo.ts:6 changed statement was not covered"])
  })

  it("fails when a changed branch arm is uncovered", () => {
    const coverage = coverageFile({
      branchMap: {
        "0": {
          locations: [
            { start: { line: 4 }, end: { line: 4 } },
            { start: { line: 4 }, end: { line: 4 } },
          ],
        },
      },
      b: { "0": [1, 0] },
    })

    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverage]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([4])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result.failures).toEqual(["src/game/foo.ts:4 changed branch was not fully covered"])
  })

  it("fails when a changed function is uncovered", () => {
    const coverage = coverageFile({
      fnMap: {
        "0": { loc: { start: { line: 8 }, end: { line: 10 } } },
      },
      f: { "0": 0 },
    })

    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverage]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([8])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result.failures).toEqual(["src/game/foo.ts:8 changed function was not covered"])
  })

  it("passes when changed executable entries are covered", () => {
    const coverage = coverageFile({
      statementMap: {
        "0": { start: { line: 3 }, end: { line: 3 } },
      },
      s: { "0": 1 },
      fnMap: {
        "0": { loc: { start: { line: 3 }, end: { line: 5 } } },
      },
      f: { "0": 1 },
    })

    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverage]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([3])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result).toEqual({ ok: true, failures: [] })
  })

  it("passes when changed branch entries are fully covered", () => {
    const coverage = coverageFile({
      branchMap: {
        "0": {
          locations: [
            { start: { line: 4 }, end: { line: 4 } },
            { start: { line: 4 }, end: { line: 4 } },
          ],
        },
      },
      b: { "0": [1, 1] },
    })

    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverage]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([4])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result).toEqual({ ok: true, failures: [] })
  })

  it("passes when changed branch metadata has no counters", () => {
    const coverage = coverageFile({
      branchMap: {
        "0": {
          locations: [{ start: { line: 9 }, end: { line: 9 } }],
        },
      },
    })

    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverage]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([9])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result).toEqual({ ok: true, failures: [] })
  })

  it("treats missing changed function counters as uncovered", () => {
    const coverage = coverageFile({
      fnMap: {
        "0": { loc: { start: { line: 11 }, end: { line: 13 } } },
      },
    })

    const result = assertChangedLineCoverage({
      coverageByFile: new Map([["src/game/foo.ts", coverage]]),
      changedLinesByFile: new Map([["src/game/foo.ts", new Set([11])]]),
      requiredFiles: ["src/game/foo.ts"],
    })

    expect(result.failures).toEqual(["src/game/foo.ts:11 changed function was not covered"])
  })
})

describe("runAssertRubberbandingCoverage", () => {
  it("returns zero when changed executable lines are covered", () => {
    const log = viFn()
    const error = viFn()
    const coverage = {
      "/repo/src/game/foo.ts": coverageFile({
        statementMap: {
          "0": { start: { line: 3 }, end: { line: 3 } },
        },
        s: { "0": 1 },
      }),
    }

    expect(
      runAssertRubberbandingCoverage(["--coverage", "coverage/custom.json"], {
        cwd: "/repo",
        readFile: (file) => {
          expect(file).toBe("/repo/coverage/custom.json")
          return JSON.stringify(coverage)
        },
        exec: fakeExec({
          "git diff --name-only origin/main...HEAD": "src/game/foo.ts\n",
          "git diff --name-only --cached": "",
          "git diff --name-only": "src/game/foo.ts\n",
          "git diff --unified=0 origin/main...HEAD": coveredFooDiff(),
          "git diff --unified=0 --cached": "",
          "git diff --unified=0": "",
        }),
        log,
        error,
      }),
    ).toBe(0)
    expect(log).toHaveBeenCalledWith("rubberbanding changed-line coverage assertions passed")
    expect(error).not.toHaveBeenCalled()
  })

  it("treats coverage flags without values as absent", () => {
    const coverage = {
      "/repo/src/game/foo.ts": coverageFile({
        statementMap: {
          "0": { start: { line: 3 }, end: { line: 3 } },
        },
        s: { "0": 1 },
      }),
    }

    expect(
      runAssertRubberbandingCoverage(["--coverage"], {
        cwd: "/repo",
        readFile: (file) => {
          expect(file).toBe("/repo/coverage/coverage-final.json")
          return JSON.stringify(coverage)
        },
        exec: fakeExec({
          "git diff --name-only origin/main...HEAD": "src/game/foo.ts\n",
          "git diff --name-only --cached": "",
          "git diff --name-only": "",
          "git diff --unified=0 origin/main...HEAD": coveredFooDiff(),
          "git diff --unified=0 --cached": "",
          "git diff --unified=0": "",
        }),
        log: viFn(),
        error: viFn(),
      }),
    ).toBe(0)
  })

  it("returns one and logs changed-line failures", () => {
    const error = viFn()
    const coverage = {
      "/repo/src/game/foo.ts": coverageFile({
        statementMap: {
          "0": { start: { line: 3 }, end: { line: 3 } },
        },
        s: { "0": 0 },
      }),
    }

    expect(
      runAssertRubberbandingCoverage([], {
        cwd: "/repo",
        readFile: () => JSON.stringify(coverage),
        exec: fakeExec({
          "git diff --name-only origin/main...HEAD": "src/game/foo.ts\n",
          "git diff --name-only --cached": "",
          "git diff --name-only": "",
          "git diff --unified=0 origin/main...HEAD": coveredFooDiff(),
          "git diff --unified=0 --cached": "",
          "git diff --unified=0": "",
        }),
        log: viFn(),
        error,
      }),
    ).toBe(1)
    expect(error).toHaveBeenCalledWith("src/game/foo.ts:3 changed statement was not covered")
  })

  it("returns one and logs parse/read failures", () => {
    const error = viFn()

    expect(
      runAssertRubberbandingCoverage([], {
        cwd: "/repo",
        readFile: () => {
          throw new Error("missing coverage")
        },
        exec: fakeExec({}),
        log: viFn(),
        error,
      }),
    ).toBe(1)
    expect(error).toHaveBeenCalledWith("rubberbanding changed-line coverage assertion failed")
    expect(error).toHaveBeenCalledWith("missing coverage")
  })
})

function coveredFooDiff(): string {
  return [
    "diff --git a/src/game/foo.ts b/src/game/foo.ts",
    "--- a/src/game/foo.ts",
    "+++ b/src/game/foo.ts",
    "@@ -3,0 +3,1 @@",
    "+covered()",
  ].join("\n")
}

function fakeExec(outputs: Record<string, string>): (command: string) => string {
  return (command: string) => outputs[command] ?? ""
}

function viFn() {
  return vi.fn()
}

function coverageFile(overrides: Partial<IstanbulCoverageFile>): IstanbulCoverageFile {
  return {
    path: "/repo/src/game/foo.ts",
    statementMap: {},
    s: {},
    branchMap: {},
    b: {},
    fnMap: {},
    f: {},
    ...overrides,
  }
}
