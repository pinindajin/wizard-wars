import { describe, expect, it } from "vitest"

import { buildRequestUrl } from "./requestUrl"

function req(url: string, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    url,
  }
}

describe("buildRequestUrl", () => {
  it("uses request.url origin when host headers are absent", () => {
    expect(buildRequestUrl(req("https://example.com/logout"), "/login").toString()).toBe(
      "https://example.com/login",
    )
  })

  it("preserves the real host header when the custom server request URL uses the default port", () => {
    expect(
      buildRequestUrl(
        req("http://localhost:3000/logout", { host: "127.0.0.1:34954" }),
        "/login",
      ).toString(),
    ).toBe("http://127.0.0.1:34954/login")
  })

  it("prefers forwarded host and proto from a reverse proxy", () => {
    expect(
      buildRequestUrl(
        req("http://localhost:3000/logout", {
          host: "127.0.0.1:3000",
          "x-forwarded-host": "wizard-wars.pinindajin.online",
          "x-forwarded-proto": "https",
        }),
        "/login?next=%2Fhome",
      ).toString(),
    ).toBe("https://wizard-wars.pinindajin.online/login?next=%2Fhome")
  })
})
