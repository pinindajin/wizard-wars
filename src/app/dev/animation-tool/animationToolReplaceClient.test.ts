/**
 * `createImageBitmap` is stubbed per test; Vitest uses jsdom here so globals match browser usage.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  bumpReplacesSinceRebuild,
  clearReplacesSinceRebuild,
  LADY_WIZARD_REPLACE_MAX_FILE_BYTES,
  replaceStripCacheKey,
  validateLadyWizardReplaceFile,
  withStripCacheBust,
} from "./animationToolReplaceClient"

function mockCreateImageBitmap(width: number, height: number): void {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({
      width,
      height,
      close: vi.fn(),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("animationToolReplaceClient", () => {
  it("builds a stable cache key", () => {
    expect(replaceStripCacheKey("walk", "east")).toBe("walk:east")
  })

  it("appends v= when a version is set", () => {
    expect(withStripCacheBust("/assets/foo.png", undefined)).toBe("/assets/foo.png")
    expect(withStripCacheBust("/assets/foo.png", "2026")).toBe("/assets/foo.png?v=2026")
    expect(withStripCacheBust("/assets/foo.png?x=1", "2026")).toBe("/assets/foo.png?x=1&v=2026")
  })

  it("bumps and clears rebuild counter helpers", () => {
    expect(bumpReplacesSinceRebuild(0)).toBe(1)
    expect(bumpReplacesSinceRebuild(3)).toBe(4)
    expect(clearReplacesSinceRebuild()).toBe(0)
  })

  it("accepts a PNG when dimensions match expected frames", async () => {
    mockCreateImageBitmap(15 * 124, 124)
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "walk-east.png", {
      type: "image/png",
    })
    const result = await validateLadyWizardReplaceFile(file, 15)
    expect(result).toEqual({ ok: true })
  })

  it("rejects wrong dimensions from decoded bitmap", async () => {
    mockCreateImageBitmap(14 * 124, 124)
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" })
    const result = await validateLadyWizardReplaceFile(file, 15)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/expected 1860/)
    }
  })

  it("rejects oversize files before decode", async () => {
    const big = new Uint8Array(LADY_WIZARD_REPLACE_MAX_FILE_BYTES + 1)
    const file = new File([big], "huge.png", { type: "image/png" })
    const result = await validateLadyWizardReplaceFile(file, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/too large/)
    }
  })

  it("rejects non-png extension / type", async () => {
    const file = new File([Buffer.from("x")], "x.jpg", { type: "image/jpeg" })
    const result = await validateLadyWizardReplaceFile(file, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/PNG/i)
    }
  })
})
