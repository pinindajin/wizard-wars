import { describe, expect, it } from "vitest"

import {
  DEFAULT_VISUAL_NET_SEND_RATE_HZ,
  REMOTE_RENDER_DELAY_MAX_MS,
  TICK_MS,
  resolveGameNetTiming,
  resolveRemoteRenderDelayMs,
} from "./rendering"

describe("remote interpolation net timing", () => {
  it("derives a remote render delay from two visual sends plus one sim tick", () => {
    expect(resolveRemoteRenderDelayMs(1000 / 60)).toBe(50)
    expect(resolveRemoteRenderDelayMs(1000 / 30)).toBe(84)
    expect(resolveRemoteRenderDelayMs(1000 / 10)).toBe(217)
  })

  it("falls back to the default visual send cadence for invalid intervals", () => {
    const fallback = resolveRemoteRenderDelayMs(1000 / DEFAULT_VISUAL_NET_SEND_RATE_HZ)

    expect(resolveRemoteRenderDelayMs(0)).toBe(fallback)
    expect(resolveRemoteRenderDelayMs(-1)).toBe(fallback)
    expect(resolveRemoteRenderDelayMs(Number.NaN)).toBe(fallback)
    expect(resolveRemoteRenderDelayMs(Number.POSITIVE_INFINITY)).toBe(fallback)
  })

  it("clamps remote delay guardrails without hiding the configured cadence", () => {
    expect(resolveRemoteRenderDelayMs(1)).toBe(Math.ceil(3 * TICK_MS))
    expect(resolveRemoteRenderDelayMs(10_000)).toBe(REMOTE_RENDER_DELAY_MAX_MS)
  })

  it("normalizes complete timing payloads and ignores malformed timing", () => {
    expect(resolveGameNetTiming({ netSendRateHz: 30 })).toMatchObject({
      protocolVersion: 1,
      tickRateHz: 60,
      tickMs: TICK_MS,
      netSendRateHz: 30,
      netSendIntervalMs: 1000 / 30,
      remoteRenderDelayMs: 84,
    })

    expect(resolveGameNetTiming({ netSendIntervalMs: 1000 / 60 }).remoteRenderDelayMs).toBe(50)
    expect(resolveGameNetTiming({ remoteRenderDelayMs: 999 }).remoteRenderDelayMs).toBe(84)
    expect(resolveGameNetTiming({ netSendRateHz: Number.NaN }).remoteRenderDelayMs).toBe(84)
  })
})
