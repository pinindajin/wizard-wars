import { describe, expect, it } from "vitest"

import { GET } from "./route"

/**
 * Builds the minimal request shape used by the logout route.
 *
 * @returns Request-like object.
 */
function req() {
  const url = new URL("https://example.com/logout")
  return {
    url: url.toString(),
  } as Parameters<typeof GET>[0]
}

describe("GET /logout", () => {
  it("clears cookie and redirects to login", async () => {
    const res = await GET(req())
    expect(res.status).toBe(307)
    expect(res.headers.get("set-cookie")).toContain("ww-token=")
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0")
    expect(res.headers.get("location")).toBe("https://example.com/login")
  })
})
