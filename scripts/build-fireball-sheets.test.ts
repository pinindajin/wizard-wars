import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { afterEach, describe, expect, it } from "vitest"

import {
  buildFireballFlySheet,
  FIREBALL_FLY_FRAME_COUNT,
  FIREBALL_FLY_FRAME_SIZE_PX,
  resolveFireballFlyFramePaths,
} from "./build-fireball-sheets"

const SOURCE_FRAME_WIDTH = 64
const SOURCE_FRAME_HEIGHT = 32

const tempDirs: string[] = []

/**
 * Creates a tracked temporary directory that is removed after each test.
 *
 * @returns Absolute path to the new temporary directory.
 */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ww-fireball-sheet-"))
  tempDirs.push(dir)
  return dir
}

/**
 * Writes a solid, east-facing-size source frame with a frame-specific color.
 *
 * @param path - Destination PNG path.
 * @param frameIndex - Zero-based frame index used to vary the color.
 */
async function writeFixtureFrame(path: string, frameIndex: number): Promise<void> {
  const raw = Buffer.alloc(SOURCE_FRAME_WIDTH * SOURCE_FRAME_HEIGHT * 4, 0)
  for (let y = 0; y < SOURCE_FRAME_HEIGHT; y++) {
    for (let x = 0; x < SOURCE_FRAME_WIDTH; x++) {
      const i = (y * SOURCE_FRAME_WIDTH + x) * 4
      raw[i] = 220
      raw[i + 1] = 70 + frameIndex
      raw[i + 2] = 20
      raw[i + 3] = 255
    }
  }
  await sharp(raw, {
    raw: {
      width: SOURCE_FRAME_WIDTH,
      height: SOURCE_FRAME_HEIGHT,
      channels: 4,
    },
  })
    .png()
    .toFile(path)
}

/**
 * Counts non-transparent pixels in an RGBA raw buffer.
 *
 * @param raw - RGBA pixels.
 * @returns Count of pixels whose alpha channel is non-zero.
 */
function countOpaquePixels(raw: Buffer): number {
  let count = 0
  for (let i = 3; i < raw.length; i += 4) {
    if (raw[i]! > 0) count++
  }
  return count
}

/**
 * Finds the visible alpha bounds inside an RGBA raw buffer.
 *
 * @param raw - RGBA pixels.
 * @param width - Buffer width in pixels.
 * @param height - Buffer height in pixels.
 * @returns Visible bounds, or `null` when the buffer is fully transparent.
 */
function alphaBounds(
  raw: Buffer,
  width: number,
  height: number,
): { width: number; height: number } | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = raw[(y * width + x) * 4 + 3]!
      if (alpha === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { width: maxX - minX + 1, height: maxY - minY + 1 }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
})

describe("buildFireballFlySheet", () => {
  it("builds five nearest-neighbor contained frames into 256px cells", async () => {
    const sourceDir = makeTempDir()
    const outputDir = makeTempDir()
    const outPath = join(outputDir, "fireball-fly.png")
    for (let i = 0; i < FIREBALL_FLY_FRAME_COUNT; i++) {
      await writeFixtureFrame(join(sourceDir, `FB00${i + 1}.png`), i)
    }

    const result = await buildFireballFlySheet({ sourceDir, outPath })

    expect(result).toEqual({
      outPath,
      frameCount: 5,
      frameSize: 256,
      width: 1280,
      height: 256,
    })
    const meta = await sharp(outPath).metadata()
    expect(meta.width).toBe(FIREBALL_FLY_FRAME_SIZE_PX * FIREBALL_FLY_FRAME_COUNT)
    expect(meta.height).toBe(FIREBALL_FLY_FRAME_SIZE_PX)

    for (let i = 0; i < FIREBALL_FLY_FRAME_COUNT; i++) {
      const { data } = await sharp(outPath)
        .extract({
          left: FIREBALL_FLY_FRAME_SIZE_PX * i,
          top: 0,
          width: FIREBALL_FLY_FRAME_SIZE_PX,
          height: FIREBALL_FLY_FRAME_SIZE_PX,
        })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect(countOpaquePixels(data)).toBeGreaterThan(0)
      expect(alphaBounds(data, FIREBALL_FLY_FRAME_SIZE_PX, FIREBALL_FLY_FRAME_SIZE_PX)).toEqual({
        width: 256,
        height: 128,
      })
    }
  })

  it("writes deterministic output for the same source frames", async () => {
    const sourceDir = makeTempDir()
    const outputDir = makeTempDir()
    const outA = join(outputDir, "a.png")
    const outB = join(outputDir, "b.png")
    for (let i = 0; i < FIREBALL_FLY_FRAME_COUNT; i++) {
      await writeFixtureFrame(join(sourceDir, `FB00${i + 1}.png`), i)
    }

    await buildFireballFlySheet({ sourceDir, outPath: outA })
    await buildFireballFlySheet({ sourceDir, outPath: outB })

    expect(readFileSync(outA).equals(readFileSync(outB))).toBe(true)
  })
})

describe("resolveFireballFlyFramePaths", () => {
  it("fails clearly when any required source frame is missing", async () => {
    const sourceDir = makeTempDir()
    for (let i = 0; i < FIREBALL_FLY_FRAME_COUNT - 1; i++) {
      await writeFixtureFrame(join(sourceDir, `FB00${i + 1}.png`), i)
    }

    await expect(resolveFireballFlyFramePaths(sourceDir)).rejects.toThrow(
      /missing required frames: FB005\.png/,
    )
  })
})
