import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { buildHomingOrbFlySheet } from "./build-homing-orb-sheets"

/**
 * Returns the visible alpha bounds of an RGBA buffer.
 */
function visibleBounds(
  raw: Buffer,
  width: number,
  height: number,
): { width: number; height: number } {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = raw[(y * width + x) * 4 + 3]!
      if (alpha === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 }
}

describe("buildHomingOrbFlySheet", () => {
  it("scales visible source pixels and purple-shifts output frames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "homing-orb-sheet-"))
    try {
      const sourcePath = join(dir, "fireball-fly.png")
      const outPath = join(dir, "homing-orb-fly.png")
      const frameSize = 8
      const frameCount = 5

      const cell = await sharp({
        create: {
          width: frameSize,
          height: frameSize,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([
          {
            input: {
              create: {
                width: 4,
                height: 4,
                channels: 4,
                background: { r: 240, g: 120, b: 20, alpha: 1 },
              },
            },
            left: 2,
            top: 2,
          },
        ])
        .png()
        .toBuffer()

      await sharp({
        create: {
          width: frameSize * frameCount,
          height: frameSize,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(Array.from({ length: frameCount }, (_, index) => ({
          input: cell,
          left: index * frameSize,
          top: 0,
        })))
        .png()
        .toFile(sourcePath)

      await buildHomingOrbFlySheet({
        sourcePath,
        outPath,
        frameSize,
        frameCount,
        log: () => {},
      })

      const meta = await sharp(outPath).metadata()
      expect(meta.width).toBe(frameSize * frameCount)
      expect(meta.height).toBe(frameSize)

      const { data, info } = await sharp(outPath)
        .extract({ left: 0, top: 0, width: frameSize, height: frameSize })
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect(visibleBounds(data, info.width, info.height)).toEqual({ width: 2, height: 2 })

      const opaquePixelIndex = data.findIndex((value, index) => index % 4 === 3 && value > 0) - 3
      expect(data[opaquePixelIndex + 2]).toBeGreaterThan(data[opaquePixelIndex + 1])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
