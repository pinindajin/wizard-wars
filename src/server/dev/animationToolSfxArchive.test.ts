import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  DEFAULT_SFX_ARCHIVE_ROOT,
  resolveSfxArchiveRoot,
  sfxArchiveDayDir,
} from "./animationToolSfxArchive"

const original = process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR

function restoreEnv(): void {
  if (original === undefined) {
    delete process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR
  } else {
    process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR = original
  }
}

afterEach(() => {
  restoreEnv()
})

describe("animationToolSfxArchive", () => {
  it("resolveSfxArchiveRoot falls back when env unset", () => {
    delete process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR
    expect(resolveSfxArchiveRoot()).toBe(DEFAULT_SFX_ARCHIVE_ROOT)
  })

  it("resolveSfxArchiveRoot uses absolute env path", () => {
    process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR = "/tmp/ww-sfx-archive-test-abs"
    expect(resolveSfxArchiveRoot()).toBe("/tmp/ww-sfx-archive-test-abs")
  })

  it("resolveSfxArchiveRoot ignores relative env", () => {
    process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR = "relative/path"
    expect(resolveSfxArchiveRoot()).toBe(DEFAULT_SFX_ARCHIVE_ROOT)
  })

  it("sfxArchiveDayDir nests dated wizard-wars path", () => {
    const d = new Date(Date.UTC(2026, 4, 4, 12, 0, 0))
    expect(sfxArchiveDayDir("/archive", d)).toBe(join("/archive", "wizard-wars", "sfx", "2026-05-04"))
  })
})
