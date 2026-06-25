import { describe, expect, it, vi } from "vitest"

import {
  RealtimeAdminError,
  requestRealtimeAdmin,
  resolveRealtimeAdminConfig,
} from "./adminClient"

describe("realtime admin client", () => {
  it("resolves trimmed realtime admin configuration", () => {
    expect(
      resolveRealtimeAdminConfig({
        WW_REALTIME_ADMIN_URL: " http://realtime:3001/ ",
        WW_REALTIME_ADMIN_TOKEN: " secret ",
      }),
    ).toEqual({
      url: "http://realtime:3001",
      token: "secret",
      timeoutMs: 2500,
    })
  })

  it("returns null when the bridge is not configured", () => {
    expect(resolveRealtimeAdminConfig({})).toBeNull()
  })

  it("clamps configured timeout values", () => {
    expect(
      resolveRealtimeAdminConfig({
        WW_REALTIME_ADMIN_URL: "http://realtime:3001",
        WW_REALTIME_ADMIN_TOKEN: "secret",
        WW_REALTIME_ADMIN_TIMEOUT_MS: "60000",
      })?.timeoutMs,
    ).toBe(30_000)
    expect(
      resolveRealtimeAdminConfig({
        WW_REALTIME_ADMIN_URL: "http://realtime:3001",
        WW_REALTIME_ADMIN_TOKEN: "secret",
        WW_REALTIME_ADMIN_TIMEOUT_MS: "50",
      })?.timeoutMs,
    ).toBe(2500)
  })

  it("sends bearer service auth and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    await expect(
      requestRealtimeAdmin<{ ok: boolean }>({
        config: { url: "http://realtime:3001", token: "secret", timeoutMs: 2500 },
        path: "/internal/lobbies",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true })

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://realtime:3001/internal/lobbies",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret",
        }),
      }),
    )
  })

  it("maps realtime admin auth failures to response statuses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    )

    await expect(
      requestRealtimeAdmin({
        config: { url: "http://realtime:3001", token: "bad", timeoutMs: 2500 },
        path: "/internal/lobbies",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 403,
      body: { error: "Forbidden" },
    })
  })

  it("falls back when realtime returns non-JSON text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("upstream nope", { status: 502 }))

    await expect(
      requestRealtimeAdmin({
        config: { url: "http://realtime:3001", token: "secret", timeoutMs: 2500 },
        path: "/internal/lobbies",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: { error: "upstream nope" },
    })
  })

  it("returns an empty body for empty success responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }))

    await expect(
      requestRealtimeAdmin({
        config: { url: "http://realtime:3001", token: "secret", timeoutMs: 2500 },
        path: "/healthz",
        fetchImpl,
      }),
    ).resolves.toEqual({})
  })

  it("maps fetch failures to realtime unavailable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"))

    await expect(
      requestRealtimeAdmin({
        config: { url: "http://realtime:3001", token: "secret", timeoutMs: 2500 },
        path: "/internal/lobbies",
        fetchImpl,
      }),
    ).rejects.toEqual(new RealtimeAdminError(503, { error: "Realtime unavailable" }))
  })

  it("maps aborted requests to gateway timeout", async () => {
    const err = new Error("aborted")
    err.name = "AbortError"
    const fetchImpl = vi.fn().mockRejectedValue(err)

    await expect(
      requestRealtimeAdmin({
        config: { url: "http://realtime:3001", token: "secret", timeoutMs: 2500 },
        path: "/internal/lobbies",
        fetchImpl,
      }),
    ).rejects.toEqual(new RealtimeAdminError(504, { error: "Realtime admin timeout" }))
  })
})
