import { describe, expect, it } from "vitest"

import { ladyWizardAtlasPublicPath, ladyWizardStripPublicPath } from "./ladyWizard"

describe("ladyWizard public paths", () => {
  it("builds strip png path", () => {
    expect(ladyWizardStripPublicPath("idle", "south")).toContain("idle-south.png")
  })

  it("builds atlas json path", () => {
    expect(ladyWizardAtlasPublicPath()).toContain("atlas.json")
  })
})
