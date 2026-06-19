import { describe, expect, it } from "vitest"

import {
  assertChangedLineCoverage,
  parseChangedLineDiff,
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
})

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
