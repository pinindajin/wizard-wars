import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

import { verifyAdminToken } from "./verifyAdminToken"

const prismaMock = {
  user: {
    findUnique: vi.fn(),
  },
} as unknown as PrismaClient & { user: { findUnique: ReturnType<typeof vi.fn> } }

/**
 * Creates a signed test auth token.
 *
 * @param sub - JWT subject.
 * @param username - JWT username.
 * @returns Signed token.
 */
async function tokenFor(sub: string, username: string): Promise<string> {
  vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
  const { signToken } = await import("@/server/auth")
  return signToken({ sub, username })
}

describe("verifyAdminToken", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    prismaMock.user.findUnique.mockReset()
  })

  it("rejects missing tokens", async () => {
    await expect(verifyAdminToken(prismaMock, undefined)).resolves.toEqual({
      ok: false,
      reason: "missing_token",
    })
  })

  it("rejects invalid tokens", async () => {
    await expect(verifyAdminToken(prismaMock, "bad-token")).resolves.toEqual({
      ok: false,
      reason: "invalid_token",
    })
  })

  it("rejects non-admin users", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Player",
      usernameLower: "player",
      isAdmin: false,
    })

    await expect(verifyAdminToken(prismaMock, await tokenFor("u1", "Player"))).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    })
  })

  it("accepts users with User.isAdmin", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Admin",
      usernameLower: "admin",
      isAdmin: true,
    })

    const result = await verifyAdminToken(prismaMock, await tokenFor("u1", "Admin"))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.auth.sub).toBe("u1")
      expect(result.admin.isAdmin).toBe(true)
    }
  })

  it("rejects stale users when protected verification is enabled", async () => {
    vi.stubEnv("VERIFY_USER_ON_PROTECTED", "true")
    prismaMock.user.findUnique.mockResolvedValueOnce(null)

    await expect(verifyAdminToken(prismaMock, await tokenFor("missing", "Admin"))).resolves.toEqual({
      ok: false,
      reason: "stale_user",
    })
  })
})
