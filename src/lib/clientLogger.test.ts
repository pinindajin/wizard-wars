import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientLogger, getClientSessionId, installWwLogControls } from "./clientLogger"

function storage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  }
}

describe("clientLogger", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: storage(),
      sessionStorage: storage(),
    })
    vi.stubGlobal("crypto", { randomUUID: () => "client-session-1" })
    vi.spyOn(console, "debug").mockImplementation(() => undefined)
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("defaults to silent and suppresses logs", () => {
    const logger = new ClientLogger()
    logger.warn({ event: "net.test" }, "hidden")
    expect(console.warn).not.toHaveBeenCalled()
    expect(logger.status()).toMatchObject({ enabled: false, level: "silent" })
  })

  it("enables, persists, and disables logs", () => {
    const logger = new ClientLogger()
    logger.enable("debug")
    logger.debug({ event: "net.test", token: "secret" }, "shown")
    expect(console.debug).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem("ww_log_level")).toBe("debug")

    logger.disable()
    expect(logger.status()).toMatchObject({ enabled: false, level: "silent" })
    expect(window.localStorage.getItem("ww_log_level")).toBeNull()
  })

  it("installs window controls", () => {
    installWwLogControls()
    expect(window.wwLog?.status()).toMatchObject({ enabled: false, level: "silent" })
    window.wwLog?.enable("info")
    expect(window.wwLog?.level()).toBe("info")
    expect(() => window.wwLog?.level("bad" as never)).toThrow(/Invalid wwLog level/)
  })

  it("creates stable client session IDs", () => {
    expect(getClientSessionId()).toBe("client-session-1")
    expect(getClientSessionId()).toBe("client-session-1")
  })
})
