import { describe, expect, it } from "vitest"

import { GET } from "./route"

/**
 * Builds the minimal request shape used by the session-expired route.
 *
 * @param next - Candidate next path.
 * @returns Request-like object.
 */
function req(next: string | null) {
  const url = new URL("https://example.com/api/auth/session-expired")
  if (next !== null) url.searchParams.set("next", next)
  return {
    nextUrl: url,
    url: url.toString(),
  } as Parameters<typeof GET>[0]
}

describe("GET /api/auth/session-expired", () => {
  it("clears cookie and redirects to login with safe next", async () => {
    const res = await GET(req("/lobby/r1?tab=x"))
    expect(res.status).toBe(307)
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0")
    expect(res.headers.get("location")).toContain(
      "/login?next=%2Flobby%2Fr1%3Ftab%3Dx&reason=session-expired",
    )
  })

  it("rejects unsafe next paths", async () => {
    const res = await GET(req("//evil.example"))
    expect(res.headers.get("location")).toContain(
      "/login?next=%2Fhome&reason=session-expired",
    )
  })
})
