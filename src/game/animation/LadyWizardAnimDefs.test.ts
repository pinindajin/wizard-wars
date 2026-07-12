import { describe, expect, it, vi } from "vitest"

import {
  DIRECTIONS,
  getAnimKey,
  getDirectionFromAngle,
  getHeroAnimKey,
  registerHeroSpriteAnims,
  registerLadyWizardAnims,
} from "./LadyWizardAnimDefs"
import {
  LADY_WIZARD_MEGASHEET_CLIP_ORDER,
} from "@/shared/sprites/ladyWizard"

describe("LadyWizardAnimDefs", () => {
  it("builds animation keys and falls back to idle for unknown states", () => {
    expect(getAnimKey("walk", "south")).toBe("lady-wizard-walk-south")
    expect(getAnimKey("not-real", "north")).toBe("lady-wizard-breathing_idle-north")
    expect(getHeroAnimKey("yen", "walk", "south")).toBe("lady-wizard-walk-south")
    expect(getHeroAnimKey("triss", "walk", "south")).toBe("triss-walk-south")
    expect(getHeroAnimKey("triss", "primary_melee_attack", "north")).toBe(
      "triss-big_blast-north",
    )
    expect(getHeroAnimKey("helena", "light_cast", "south", "fireball")).toBe(
      "helena-fire_spell-fireball-south",
    )
    expect(getHeroAnimKey("helena", "light_cast", "south", "homing_orb")).toBe(
      "helena-spell_2-homing_orb-south",
    )
    expect(getHeroAnimKey("helena", "heavy_cast", "south", "lightning_bolt")).toBe(
      "helena-spell_2-lightning_bolt-south",
    )
    expect(getHeroAnimKey("not-real", "idle", "north")).toBe("lady-wizard-breathing_idle-north")
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
        frames: expect.arrayContaining([
          expect.objectContaining({ duration: 180 }),
          expect.objectContaining({ duration: 40 }),
        ]),
      }),
    )

    expect(animManager.generateFrameNumbers).toHaveBeenCalledTimes(
      (LADY_WIZARD_MEGASHEET_CLIP_ORDER.length - 1) * DIRECTIONS.length,
    )
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

  it("registers all hero animations and ability-scoped Helena casts", () => {
    const animManager = {
      exists: vi.fn(() => false),
      generateFrameNumbers: vi.fn((texture: string, range: { start: number; end: number }) => [
        `${texture}:${range.start}`,
        `${texture}:${range.end}`,
      ]),
      create: vi.fn(),
    }

    registerHeroSpriteAnims(animManager as never)

    expect(animManager.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: "lady-wizard-walk-south" }),
    )
    expect(animManager.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: "triss-idle-south" }),
    )
    expect(animManager.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: "triss-big_blast-south-west" }),
    )
    expect(animManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "helena-fire_spell-fireball-south",
        frameRate: 34,
      }),
    )
    expect(animManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "helena-spell_2-homing_orb-south",
        frameRate: 34,
      }),
    )
    expect(animManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "helena-spell_2-lightning_bolt-south",
        frameRate: 17 / 0.7,
      }),
    )
  })
})
