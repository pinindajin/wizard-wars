import { describe, expect, it } from "vitest"

import {
  ladyWizardAnimationsArchiveFsDir,
  ladyWizardAnimationsFramesFsDir,
  ladyWizardAtlasFsPath,
  ladyWizardAtlasPublicPath,
  ladyWizardSheetsArchiveFsDir,
  ladyWizardSheetsFsDir,
  ladyWizardStripFsPath,
  ladyWizardStripPublicPath,
} from "./ladyWizard"

describe("ladyWizard public paths", () => {
  it("builds strip png path", () => {
    expect(ladyWizardStripPublicPath("idle", "south")).toContain("idle-south.png")
  })

  it("builds atlas json path", () => {
    expect(ladyWizardAtlasPublicPath()).toContain("atlas.json")
  })
})

describe("ladyWizard fs paths", () => {
  it("builds strip fs path under given cwd", () => {
    expect(ladyWizardStripFsPath("walk", "east", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/lady-wizard/sheets/walk-east.png",
    )
  })

  it("builds animations frames fs dir under given cwd", () => {
    expect(ladyWizardAnimationsFramesFsDir("walk", "east", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/lady-wizard/animations/walk/east",
    )
  })

  it("builds archive fs dirs under given cwd", () => {
    expect(ladyWizardSheetsArchiveFsDir("/repo")).toBe(
      "/repo/public/assets/sprites/heroes/lady-wizard/sheets/old",
    )
    expect(ladyWizardAnimationsArchiveFsDir("walk", "/repo")).toBe(
      "/repo/public/assets/sprites/heroes/lady-wizard/animations/old/walk",
    )
  })

  it("builds sheets fs dir + atlas fs path under given cwd", () => {
    expect(ladyWizardSheetsFsDir("/repo")).toBe(
      "/repo/public/assets/sprites/heroes/lady-wizard/sheets",
    )
    expect(ladyWizardAtlasFsPath("/repo")).toBe(
      "/repo/public/assets/sprites/heroes/lady-wizard/sheets/atlas.json",
    )
  })
})
