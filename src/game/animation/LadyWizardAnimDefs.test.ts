import { describe, expect, it, vi } from "vitest"

import {
  DIRECTIONS,
  getAnimKey,
  getDirectionFromAngle,
  registerLadyWizardAnims,
} from "./LadyWizardAnimDefs"
import {
  LADY_WIZARD_CLIP_BASE_FRAME,
  LADY_WIZARD_CLIP_FRAMES,
  LADY_WIZARD_FRAMES_PER_DIRECTION_ROW,
  LADY_WIZARD_MEGASHEET_CLIP_ORDER,
} from "@/shared/sprites/ladyWizard"

describe("LadyWizardAnimDefs", () => {
  it("builds animation keys and falls back to idle for unknown states", () => {
    expect(getAnimKey("walk", "south")).toBe("lady-wizard-walk-south")
    expect(getAnimKey("not-real", "north")).toBe("lady-wizard-breathing_idle-north")
  })

  it("maps angles into the nearest sprite direction", () => {
    expect(getDirectionFromAngle(0)).toBe("east")
    expect(getDirectionFromAngle(Math.PI / 4)).toBe("south-east")
    expect(getDirectionFromAngle(Math.PI / 2)).toBe("south")
    expect(getDirectionFromAngle(Math.PI)).toBe("west")
    expect(getDirectionFromAngle((Math.PI * 3) / 2)).toBe("north")
    expect(getDirectionFromAngle(-Math.PI / 4)).toBe("north-east")
    expect(getDirectionFromAngle(Math.PI * 2)).toBe("east")
  })

  it("registers every clip and direction with config-derived frame rates", () => {
    const existing = new Set<string>()
    const animManager = {
      exists: vi.fn((key: string) => existing.has(key)),
      generateFrameNumbers: vi.fn((texture: string, range: { start: number; end: number }) => [
        `${texture}:${range.start}`,
        `${texture}:${range.end}`,
      ]),
      create: vi.fn(),
    }

    registerLadyWizardAnims(animManager as never)

    expect(animManager.create).toHaveBeenCalledTimes(
      LADY_WIZARD_MEGASHEET_CLIP_ORDER.length * DIRECTIONS.length,
    )
    expect(animManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "lady-wizard-breathing_idle-south",
        frameRate: expect.any(Number),
        repeat: -1,
        yoyo: false,
      }),
    )
    expect(animManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "lady-wizard-summoned_axe_swing-south-west",
        repeat: 0,
      }),
    )

    const westRow = 6
    const baseFrame = LADY_WIZARD_CLIP_BASE_FRAME.summoned_axe_swing
    const frameCount = LADY_WIZARD_CLIP_FRAMES.summoned_axe_swing
    expect(animManager.generateFrameNumbers).toHaveBeenCalledWith("lady-wizard", {
      start: westRow * LADY_WIZARD_FRAMES_PER_DIRECTION_ROW + baseFrame,
      end: westRow * LADY_WIZARD_FRAMES_PER_DIRECTION_ROW + baseFrame + frameCount - 1,
    })
  })

  it("does not recreate animations that already exist", () => {
    const existingKey = "lady-wizard-breathing_idle-south"
    const animManager = {
      exists: vi.fn((key: string) => key === existingKey),
      generateFrameNumbers: vi.fn(() => []),
      create: vi.fn(),
    }

    registerLadyWizardAnims(animManager as never)

    expect(animManager.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: existingKey }),
    )
  })
})
