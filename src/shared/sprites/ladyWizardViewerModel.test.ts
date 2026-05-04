import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import type { LadyWizardAtlasJson } from "./ladyWizardViewerModel"
import { buildLadyWizardViewerCells } from "./ladyWizardViewerModel"

describe("buildLadyWizardViewerCells", () => {
  it("marks light-spell-cast south-west as missing for committed atlas", () => {
    const atlasPath = resolve(
      process.cwd(),
      "public/assets/sprites/heroes/lady-wizard/sheets/atlas.json",
    )
    const atlas = JSON.parse(readFileSync(atlasPath, "utf8")) as LadyWizardAtlasJson
    const cells = buildLadyWizardViewerCells(atlas)
    const sw = cells.find((c) => c.atlasClipId === "light-spell-cast" && c.direction === "south-west")
    expect(sw).toBeDefined()
    expect(sw!.missing).toBe(true)
  })

  it("marks summoned-axe-attack west as present for committed atlas", () => {
    const atlasPath = resolve(
      process.cwd(),
      "public/assets/sprites/heroes/lady-wizard/sheets/atlas.json",
    )
    const atlas = JSON.parse(readFileSync(atlasPath, "utf8")) as LadyWizardAtlasJson
    const cells = buildLadyWizardViewerCells(atlas)
    const west = cells.find((c) => c.atlasClipId === "summoned-axe-attack" && c.direction === "west")
    expect(west).toBeDefined()
    expect(west!.missing).toBe(false)
    expect(west!.frameCount).toBe(7)
  })

  it("marks idle south as present with positive frames", () => {
    const atlasPath = resolve(
      process.cwd(),
      "public/assets/sprites/heroes/lady-wizard/sheets/atlas.json",
    )
    const atlas = JSON.parse(readFileSync(atlasPath, "utf8")) as LadyWizardAtlasJson
    const cells = buildLadyWizardViewerCells(atlas)
    const idle = cells.find((c) => c.atlasClipId === "idle" && c.direction === "south")
    expect(idle).toBeDefined()
    expect(idle!.missing).toBe(false)
    expect(idle!.frameCount).toBeGreaterThan(0)
  })
})
