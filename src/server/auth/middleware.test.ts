import { describe, expect, it, vi } from "vitest"

import { getUserFromRequest, isProtectedPath, requireAuthRedirect } from "./middleware"

function makeRequest(pathname: string, cookie?: string): Parameters<typeof getUserFromRequest>[0] {
  return {
    nextUrl: { pathname } as { pathname: string },
    url: "https://example.com",
    cookies: {
      get: (name: string) => (cookie && name === "ww-token" ? { value: cookie } : undefined),
    },
  } as Parameters<typeof getUserFromRequest>[0]
}

describe("auth middleware helpers", () => {
  it("detects protected paths", () => {
    expect(isProtectedPath("/home")).toBe(true)
    expect(isProtectedPath("/lobby/abc")).toBe(true)
    expect(isProtectedPath("/browse")).toBe(true)
    expect(isProtectedPath("/login")).toBe(false)
  })

  it("getUserFromRequest returns null without cookie", async () => {
    const u = await getUserFromRequest(makeRequest("/home"))
    expect(u).toBeNull()
  })

  it("requireAuthRedirect returns null for public paths", async () => {
    const r = await requireAuthRedirect(makeRequest("/login"))
    expect(r).toBeNull()
  })

  it("requireAuthRedirect redirects protected path without user", async () => {
    const r = await requireAuthRedirect(makeRequest("/home"))
    expect(r?.status).toBe(307)
    const loc = r?.headers.get("location")
    expect(loc).toContain("/login")
    expect(loc).toContain("next=%2Fhome")
  })

  it("requireAuthRedirect allows authenticated home", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    const { signToken } = await import("./index")
    const token = await signToken({ sub: "u1", username: "A" })
    const u = await getUserFromRequest(makeRequest("/home", token))
    expect(u?.sub).toBe("u1")
    const r = await requireAuthRedirect(
      makeRequest("/home", token) as Parameters<typeof requireAuthRedirect>[0],
    )
    expect(r).toBeNull()
    vi.unstubAllEnvs()
  })
})
