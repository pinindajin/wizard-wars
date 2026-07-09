import { describe, it, expect } from "vitest"
import sharp from "sharp"

import bootPack from "../../../public/assets/boot-asset-pack.json"
import preloadPack from "../../../public/assets/preload-asset-pack.json"
import arenaPack from "../../../public/assets/arena-asset-pack.json"
import editorPack from "../../../public/assets/asset-pack.json"

/**
 * Shared shape for an asset-pack file entry. Narrow enough for the URL
 * invariant test without dragging in Phaser's internal types.
 */
type PackFile = {
  readonly type: string
  readonly key: string
  readonly url: string | readonly string[]
  readonly frameConfig?: {
    readonly frameWidth: number
    readonly frameHeight: number
  }
}

/**
 * Flattens every URL (string or string[]) into a single list for assertion.
 *
 * @param files - Pack file entries.
 * @returns Flat array of URL strings.
 */
function collectUrls(files: readonly PackFile[]): string[] {
  const out: string[] = []
  for (const f of files) {
    if (typeof f.url === "string") out.push(f.url)
    else for (const u of f.url) out.push(u)
  }
  return out
}

/**
 * Finds an asset-pack entry by key.
 *
 * @param files - Pack file entries.
 * @param key - Phaser asset key to find.
 * @returns Matching pack file.
 */
function packFileForKey(files: readonly PackFile[], key: string): PackFile {
  const file = files.find((f) => f.key === key)
  expect(file, `expected asset pack file for key ${key}`).toBeDefined()
  return file!
}

describe("asset pack URLs are absolute", () => {
  it.each<[string, readonly PackFile[]]>([
    ["boot", (bootPack as { boot: { files: PackFile[] } }).boot.files],
    ["preload", (preloadPack as { preload: { files: PackFile[] } }).preload.files],
    ["arena", (arenaPack as { arena: { files: PackFile[] } }).arena.files],
  ])("every url in %s-asset-pack starts with '/'", (_name, files) => {
    const urls = collectUrls(files)
    for (const u of urls) {
      expect(u.startsWith("/"), `expected absolute url, got ${u}`).toBe(true)
      expect(u).not.toMatch(/^\/lobby\//)
    }
  })

  it("arena pack declares runtime gameplay files without loading the editor tilemap", () => {
    const files = (arenaPack as { arena: { files: PackFile[] } }).arena.files
    const urls = collectUrls(files)
    expect(urls).toContain("/assets/maps/arena-base.png")
    expect(files.some((file) => file.type === "tilemapTiledJSON")).toBe(false)
    expect(urls).not.toContain("/assets/tilemaps/arena.json")
    expect(urls).toContain(
      "/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png",
    )
    expect(urls).toContain("/assets/sprites/heroes/triss/sheets/triss-megasheet.png")
    expect(urls).toContain("/assets/sprites/abilities/fireball-fly.png")
    expect(urls).toContain("/assets/sprites/abilities/homing-orb-fly.png")
    expect(urls).toContain("/assets/sprites/abilities/fireball-channel.png")
    expect(urls).toContain("/assets/sprites/abilities/ember.png")
    expect(urls).toContain("/assets/sounds/sfx-homing-orb-cast.mp3")
    expect(urls).toContain("/assets/sounds/sfx-homing-orb-impact.mp3")
    expect(urls).toContain("/assets/sounds/sfx-homing-orb-expire.mp3")
  })

  it("projectile sheet metadata matches Phaser frame configs", async () => {
    const files = (arenaPack as { arena: { files: PackFile[] } }).arena.files
    const fly = packFileForKey(files, "fireball")
    const homing = packFileForKey(files, "homing-orb")
    const channel = packFileForKey(files, "fireball-channel")

    expect(fly.frameConfig).toEqual({ frameWidth: 256, frameHeight: 256 })
    expect(homing.frameConfig).toEqual({ frameWidth: 256, frameHeight: 256 })
    expect(channel.frameConfig).toEqual({ frameWidth: 64, frameHeight: 64 })

    const flyMeta = await sharp("public/assets/sprites/abilities/fireball-fly.png").metadata()
    const homingMeta = await sharp("public/assets/sprites/abilities/homing-orb-fly.png").metadata()
    const channelMeta = await sharp("public/assets/sprites/abilities/fireball-channel.png").metadata()

    expect({ width: flyMeta.width, height: flyMeta.height }).toEqual({
      width: 1280,
      height: 256,
    })
    expect({ width: homingMeta.width, height: homingMeta.height }).toEqual({
      width: 1280,
      height: 256,
    })
    expect({ width: channelMeta.width, height: channelMeta.height }).toEqual({
      width: 512,
      height: 64,
    })
    expect(flyMeta.width! / fly.frameConfig!.frameWidth).toBe(5)
    expect(homingMeta.width! / homing.frameConfig!.frameWidth).toBe(5)
    expect(channelMeta.width! / channel.frameConfig!.frameWidth).toBe(8)
  })

  it("hero sheet metadata matches Phaser frame configs", async () => {
    const files = (arenaPack as { arena: { files: PackFile[] } }).arena.files
    const yen = packFileForKey(files, "lady-wizard")
    const triss = packFileForKey(files, "triss")

    expect(yen.frameConfig).toEqual({ frameWidth: 124, frameHeight: 124 })
    expect(triss.frameConfig).toEqual({ frameWidth: 124, frameHeight: 124 })

    const yenMeta = await sharp("public/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png").metadata()
    const trissMeta = await sharp("public/assets/sprites/heroes/triss/sheets/triss-megasheet.png").metadata()

    expect({ width: yenMeta.width, height: yenMeta.height }).toEqual({
      width: 111 * 124,
      height: 8 * 124,
    })
    expect({ width: trissMeta.width, height: trissMeta.height }).toEqual({
      width: 120 * 124,
      height: 8 * 124,
    })
  })

  it("arena pack exposes prop sprites for Phaser Editor visual placement", () => {
    const files = (arenaPack as { arena: { files: PackFile[] } }).arena.files
    const urls = collectUrls(files)
    const propUrls = urls.filter((url) => url.startsWith("/assets/sprites/arena-props/"))
    expect(propUrls).toHaveLength(71)
    expect(urls).toContain("/assets/sprites/arena-props/instance-000.png")
    expect(urls).toContain("/assets/sprites/arena-props/instance-070.png")
  })
})

describe("Phaser Editor asset pack exposes arena visual assets", () => {
  it("keeps editor metadata recognizable while declaring tiles and props", () => {
    const meta = (
      editorPack as {
        meta: { contentType: string; version: number }
      }
    ).meta
    const files = (editorPack as { arena: { files: PackFile[] } }).arena.files
    const urls = collectUrls(files)

    expect(meta.contentType).toBe("phasereditor2d.pack.core.AssetContentType")
    expect(meta.version).toBe(2)
    expect(urls).toContain("assets/maps/arena-base.png")
    expect(urls).toContain("assets/tilemaps/arena.json")
    const propUrls = urls.filter((url) => url.startsWith("assets/sprites/arena-props/"))
    expect(propUrls).toHaveLength(71)
    expect(urls).toContain("assets/sprites/arena-props/instance-000.png")
    expect(urls).toContain("assets/sprites/arena-props/instance-070.png")
    for (const u of urls) {
      expect(u.startsWith("/"), `editor asset url should be project-relative: ${u}`).toBe(false)
    }
  })
})
