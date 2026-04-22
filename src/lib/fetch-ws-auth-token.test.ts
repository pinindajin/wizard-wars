import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchWsAuthSession, fetchWsAuthToken } from "./fetch-ws-auth-token"

describe("fetchWsAuthSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns parsed session on 200 with valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: "t",
          sub: "s",
          username: "u",
        }),
      }),
    )
    await expect(fetchWsAuthSession()).resolves.toEqual({
      token: "t",
      sub: "s",
      username: "u",
    })
  })

  it("returns null on non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      }),
    )
    await expect(fetchWsAuthSession()).resolves.toBeNull()
  })

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    await expect(fetchWsAuthSession()).resolves.toBeNull()
  })

  it("returns null when JSON fails parser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: "only" }),
      }),
    )
    await expect(fetchWsAuthSession()).resolves.toBeNull()
  })

  it("returns null when json() throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("bad json")
        },
      }),
    )
    await expect(fetchWsAuthSession()).resolves.toBeNull()
  })
})

describe("fetchWsAuthToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns token from fetchWsAuthSession", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: "jwt",
          sub: "sub",
          username: "n",
        }),
      }),
    )
    await expect(fetchWsAuthToken()).resolves.toBe("jwt")
  })

  it("returns null when session is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      }),
    )
    await expect(fetchWsAuthToken()).resolves.toBeNull()
  })
})
