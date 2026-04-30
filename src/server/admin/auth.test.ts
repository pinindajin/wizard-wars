import { afterEach, describe, expect, it, vi } from "vitest"

import { AdminReason, parseAdminPolicy, resolveAdminReasons, resolveEffectiveAdmin } from "./auth"

describe("admin auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("parses exact usernames and non-empty prefix case-insensitively", () => {
    vi.stubEnv("ADMIN_USERNAMES", " Jake,ALICE ,, ")
    vi.stubEnv("ADMIN_PREFIX", "Pini")
    expect(parseAdminPolicy()).toEqual({
      exactUsernames: ["jake", "alice"],
      prefix: "pini",
    })
  })

  it("disables empty prefix", () => {
    vi.stubEnv("ADMIN_PREFIX", " ")
    expect(parseAdminPolicy().prefix).toBeNull()
  })

  it("resolves User.isAdmin, exact username, and prefix reasons", () => {
    const reasons = resolveAdminReasons(
      { id: "u1", username: "Piniman", usernameLower: "piniman", isAdmin: true },
      { exactUsernames: ["piniman"], prefix: "pini" },
    )
    expect(reasons).toEqual([
      AdminReason.UserIsAdmin,
      AdminReason.AdminUsernames,
      AdminReason.AdminPrefix,
    ])
  })

  it("does not match shorter non-prefix usernames", () => {
    const reasons = resolveAdminReasons(
      { id: "u1", username: "pinman", usernameLower: "pinman", isAdmin: false },
      { exactUsernames: [], prefix: "pini" },
    )
    expect(reasons).toEqual([])
  })

  it("loads user and returns effective admin status", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })
    const result = await resolveEffectiveAdmin(
      { user: { findUnique } } as never,
      { sub: "u1", username: "Admin" },
      { exactUsernames: [], prefix: null },
    )
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }))
    expect(result.isAdmin).toBe(true)
    expect(result.reasons).toEqual([AdminReason.UserIsAdmin])
  })

  it("returns non-admin when user row is missing", async () => {
    const result = await resolveEffectiveAdmin(
      { user: { findUnique: vi.fn().mockResolvedValue(null) } } as never,
      { sub: "u1", username: "Missing" },
    )
    expect(result).toMatchObject({ user: null, isAdmin: false, reasons: [] })
  })
})
