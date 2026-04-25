import { describe, it, expect } from "vitest"

import bootPack from "../../../public/assets/boot-asset-pack.json"
import preloadPack from "../../../public/assets/preload-asset-pack.json"
import arenaPack from "../../../public/assets/arena-asset-pack.json"

/**
 * Shared shape for an asset-pack file entry. Narrow enough for the URL
 * invariant test without dragging in Phaser's internal types.
 */
type PackFile = {
  readonly type: string
  readonly key: string
  readonly url: string | readonly string[]
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

  it("arena pack declares the core gameplay files (tilemap + tileset + hero sheet + fireball assets)", () => {
    const files = (arenaPack as { arena: { files: PackFile[] } }).arena.files
    const urls = collectUrls(files)
    expect(urls).toContain("/assets/tilemaps/arena.json")
    expect(urls).toContain("/assets/tilesets/arena-terrain.png")
    expect(urls).toContain(
      "/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png",
    )
    expect(urls).toContain("/assets/sprites/abilities/fireball-fly.png")
    expect(urls).toContain("/assets/sprites/abilities/fireball-channel.png")
    expect(urls).toContain("/assets/sprites/abilities/ember.png")
  })
})
