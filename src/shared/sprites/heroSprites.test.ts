import { describe, expect, it } from "vitest"

import {
  HERO_SPRITE_CONFIGS,
  heroAnimationsArchiveFsDir,
  heroAnimationsFramesFsDir,
  heroAtlasFsPath,
  heroAtlasPublicPath,
  heroSpriteActionClipForAtlasClip,
  heroMegasheetFsPath,
  heroMegasheetPublicPath,
  heroSheetsArchiveFsDir,
  heroSheetsFsDir,
  heroStripFsPath,
  heroStripPublicPath,
  normalizeHeroSpriteId,
} from "./heroSprites"

describe("hero sprite registry", () => {
  it("defines Yen, Triss, and Helena sprite layouts with stable frame rows", () => {
    expect(Object.keys(HERO_SPRITE_CONFIGS)).toEqual(["yen", "triss", "helena"])
    expect(HERO_SPRITE_CONFIGS.yen.spriteKey).toBe("lady-wizard")
    expect(HERO_SPRITE_CONFIGS.yen.frameSizePx).toBe(124)
    expect(HERO_SPRITE_CONFIGS.yen.framesPerDirectionRow).toBe(111)
    expect(HERO_SPRITE_CONFIGS.yen.clips.primary_melee_attack.frameCount).toBe(7)

    expect(HERO_SPRITE_CONFIGS.triss.spriteKey).toBe("triss")
    expect(HERO_SPRITE_CONFIGS.triss.frameSizePx).toBe(124)
    expect(HERO_SPRITE_CONFIGS.triss.framesPerDirectionRow).toBe(120)
    expect(HERO_SPRITE_CONFIGS.triss.clips.idle.frameCount).toBe(1)
    for (const clipId of [
      "walk",
      "death",
      "light_spell_cast",
      "heavy_spell_cast",
      "primary_melee_attack",
      "jump",
      "stumble",
    ] as const) {
      expect(HERO_SPRITE_CONFIGS.triss.clips[clipId].frameCount).toBe(17)
    }

    expect(HERO_SPRITE_CONFIGS.helena).toMatchObject({
      spriteKey: "helena",
      frameSizePx: 124,
      framesPerDirectionRow: 119,
      spellCastClipByAbilityId: {
        fireball: "light_spell_cast",
        homing_orb: "heavy_spell_cast",
        lightning_bolt: "heavy_spell_cast",
      },
    })
    expect(HERO_SPRITE_CONFIGS.helena.clips.idle.frameCount).toBe(1)
    expect(HERO_SPRITE_CONFIGS.helena.clips.stumble.frameCount).toBe(16)
    for (const clipId of [
      "walk",
      "death",
      "light_spell_cast",
      "heavy_spell_cast",
      "primary_melee_attack",
      "jump",
    ] as const) {
      expect(HERO_SPRITE_CONFIGS.helena.clips[clipId].frameCount).toBe(17)
    }
  })

  it("uses Triss source-animation names for atlas and megasheet clips", () => {
    expect(HERO_SPRITE_CONFIGS.triss.clips.light_spell_cast).toMatchObject({
      atlasClipId: "channel-fire",
      megasheetClip: "channel_fire",
      sheetPrefix: "channel-fire",
    })
    expect(HERO_SPRITE_CONFIGS.triss.clips.heavy_spell_cast).toMatchObject({
      atlasClipId: "ground-pound",
      megasheetClip: "ground_pound",
      sheetPrefix: "ground-pound",
    })
    expect(HERO_SPRITE_CONFIGS.triss.clips.primary_melee_attack).toMatchObject({
      atlasClipId: "big-blast",
      megasheetClip: "big_blast",
      sheetPrefix: "big-blast",
    })
  })

  it("normalizes legacy sprite ids to Yen", () => {
    expect(normalizeHeroSpriteId("yen")).toBe("yen")
    expect(normalizeHeroSpriteId("triss")).toBe("triss")
    expect(normalizeHeroSpriteId("helena")).toBe("helena")
    expect(normalizeHeroSpriteId("red_wizard")).toBe("yen")
    expect(normalizeHeroSpriteId("missing")).toBe("yen")
  })

  it("resolves action clips from hero-specific atlas clip ids", () => {
    expect(heroSpriteActionClipForAtlasClip("triss", "big-blast")).toBe(
      "primary_melee_attack",
    )
    expect(heroSpriteActionClipForAtlasClip("triss", "channel-fire")).toBe(
      "light_spell_cast",
    )
    expect(heroSpriteActionClipForAtlasClip("missing", "summoned-axe-attack")).toBe(
      "primary_melee_attack",
    )
    expect(heroSpriteActionClipForAtlasClip("triss", "summoned-axe-attack")).toBeNull()
  })
})

describe("hero sprite paths", () => {
  it("builds public paths for a selected hero", () => {
    expect(heroStripPublicPath("triss", "big-blast", "south")).toBe(
      "/assets/sprites/heroes/triss/sheets/big-blast-south.png",
    )
    expect(heroAtlasPublicPath("triss")).toBe("/assets/sprites/heroes/triss/sheets/atlas.json")
    expect(heroMegasheetPublicPath("triss")).toBe(
      "/assets/sprites/heroes/triss/sheets/triss-megasheet.png",
    )
  })

  it("builds filesystem paths under the given cwd", () => {
    expect(heroStripFsPath("triss", "walk", "east", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/triss/sheets/walk-east.png",
    )
    expect(heroAnimationsFramesFsDir("triss", "walk", "east", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/triss/animations/walk/east",
    )
    expect(heroSheetsArchiveFsDir("triss", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/triss/sheets/old",
    )
    expect(heroAnimationsArchiveFsDir("triss", "walk", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/triss/animations/old/walk",
    )
    expect(heroSheetsFsDir("triss", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/triss/sheets",
    )
    expect(heroAtlasFsPath("triss", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/triss/sheets/atlas.json",
    )
    expect(heroMegasheetFsPath("triss", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/triss/sheets/triss-megasheet.png",
    )
  })
})
