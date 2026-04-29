import { afterEach, describe, expect, it, vi } from "vitest"

import { getApiUrl, getColyseusUrl } from "./endpoints"

describe("getApiUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns NEXT_PUBLIC_API_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example/trpc")
    expect(getApiUrl()).toBe("https://api.example/trpc")
  })

  it("falls back to /api/trpc when env unset", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "")
    expect(getApiUrl()).toBe("/api/trpc")
  })
})

describe("getColyseusUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.stubGlobal("window", undefined as unknown as Window)
  })

  it("returns trimmed env URL when plain http(s)", () => {
    vi.stubEnv("NEXT_PUBLIC_COLYSEUS_URL", "  https://coly.example  ")
    expect(getColyseusUrl()).toBe("https://coly.example")
  })

  it("maps ws:// to http://", () => {
    vi.stubEnv("NEXT_PUBLIC_COLYSEUS_URL", "ws://127.0.0.1:2567")
    expect(getColyseusUrl()).toBe("http://127.0.0.1:2567")
  })

  it("maps wss:// to https://", () => {
    vi.stubEnv("NEXT_PUBLIC_COLYSEUS_URL", "wss://host/ws")
    expect(getColyseusUrl()).toBe("https://host/ws")
  })

  it("returns empty string on server when env unset", () => {
    vi.stubEnv("NEXT_PUBLIC_COLYSEUS_URL", undefined)
    vi.stubGlobal("window", undefined as unknown as Window)
    expect(getColyseusUrl()).toBe("")
  })

  it("uses window.location when env unset in browser", () => {
    vi.stubEnv("NEXT_PUBLIC_COLYSEUS_URL", undefined)
    vi.stubGlobal("window", {
      location: { protocol: "https:", host: "app.test" },
    } as unknown as Window)
    expect(getColyseusUrl()).toBe("https://app.test")
  })

  it("uses http protocol when page is http", () => {
    vi.stubEnv("NEXT_PUBLIC_COLYSEUS_URL", undefined)
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:3000" },
    } as unknown as Window)
    expect(getColyseusUrl()).toBe("http://localhost:3000")
  })
})
