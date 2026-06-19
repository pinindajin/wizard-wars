import { describe, expect, it } from "vitest"

import {
  resolveRubberbandingCoverageInclude,
  validateRubberbandingCoverageScope,
} from "./rubberbanding-coverage-scope"

describe("rubberbanding coverage scope", () => {
  it("includes changed production TypeScript under src and scripts", () => {
    const include = resolveRubberbandingCoverageInclude({
      changedFiles: [
        "src/shared/types.ts",
        "src/shared/types.test.ts",
        "scripts/profile-rubberbanding.ts",
        "scripts/profile-rubberbanding.test.ts",
        "README.md",
        "public/assets/arena-asset-pack.json",
      ],
    })

    expect(include).toEqual([
      "scripts/profile-rubberbanding.ts",
      "src/shared/types.ts",
    ])
  })

  it("falls back to phase-critical files before any implementation diff exists", () => {
    expect(resolveRubberbandingCoverageInclude({ changedFiles: [] })).toEqual([
      "scripts/assert-rubberbanding-profile.ts",
      "scripts/profile-rubberbanding.ts",
      "scripts/rubberbanding-coverage-scope.ts",
    ])
  })

  it("reports missing changed production files in the configured include list", () => {
    const result = validateRubberbandingCoverageScope({
      changedFiles: ["src/shared/types.ts", "scripts/profile-rubberbanding.ts"],
      configuredInclude: ["scripts/profile-rubberbanding.ts"],
    })

    expect(result).toEqual({
      ok: false,
      missing: ["src/shared/types.ts"],
    })
  })

  it("accepts a configured include list that contains every required changed production file", () => {
    expect(
      validateRubberbandingCoverageScope({
        changedFiles: ["src/shared/types.ts", "scripts/profile-rubberbanding.ts"],
        configuredInclude: ["scripts/profile-rubberbanding.ts", "src/shared/types.ts"],
      }),
    ).toEqual({
      ok: true,
      missing: [],
    })
  })

  it("excludes non-source files and spec tests from changed production paths", () => {
    expect(
      resolveRubberbandingCoverageInclude({
        changedFiles: [
          "README.md",
          "tests/integration/rubberbanding.fast.test.ts",
          "src/shared/types.spec.ts",
          "src/shared/types.spec.tsx",
          "src/shared/types.test.tsx",
          "public/assets/arena-asset-pack.json",
        ],
      }),
    ).toEqual([
      "scripts/assert-rubberbanding-profile.ts",
      "scripts/profile-rubberbanding.ts",
      "scripts/rubberbanding-coverage-scope.ts",
    ])
  })
})
