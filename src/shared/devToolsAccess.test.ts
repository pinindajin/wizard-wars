import { describe, expect, it } from "vitest"

import { usernameHasDevToolsAccess } from "./devToolsAccess"

describe("usernameHasDevToolsAccess", () => {
  it("returns true for prefix dev (any case)", () => {
    expect(usernameHasDevToolsAccess("dev")).toBe(true)
    expect(usernameHasDevToolsAccess("DevWizard")).toBe(true)
    expect(usernameHasDevToolsAccess("developer")).toBe(true)
  })

  it("returns true for suffix dev (any case)", () => {
    expect(usernameHasDevToolsAccess("mydev")).toBe(true)
    expect(usernameHasDevToolsAccess("CoolDeV")).toBe(true)
  })

  it("returns false when neither prefix nor suffix", () => {
    expect(usernameHasDevToolsAccess("wizard")).toBe(false)
    expect(usernameHasDevToolsAccess("")).toBe(false)
    expect(usernameHasDevToolsAccess("  ")).toBe(false)
    expect(usernameHasDevToolsAccess("edward")).toBe(false)
  })
})
