/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, act } from "@testing-library/react"

import CountdownOverlay from "./CountdownOverlay"

describe("CountdownOverlay SFX paths", () => {
  const audioCtor = vi.fn()
  const play = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    audioCtor.mockClear()
    play.mockClear()
    vi.stubGlobal(
      "Audio",
      class StubAudio {
        src: string
        constructor(src: string) {
          this.src = src
          audioCtor(src)
        }
        play = play
      },
    )
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("requests /assets/sounds/ MP3s (not /assets/sfx/) as the countdown ticks", async () => {
    const start = Date.now()

    render(
      <CountdownOverlay
        startAtServerTimeMs={start}
        durationMs={4000}
        onDone={() => {}}
      />,
    )

    // Advance through 3 → 2 → 1 → GO!
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
    }

    const srcs = audioCtor.mock.calls.map((c) => c[0] as string)
    expect(srcs.length).toBeGreaterThan(0)
    for (const src of srcs) {
      expect(src.startsWith("/assets/sounds/")).toBe(true)
      expect(src).not.toMatch(/\/assets\/sfx\//)
    }
    expect(srcs.some((s) => s.includes("sfx-countdown-beep.mp3"))).toBe(true)
    expect(srcs.some((s) => s.includes("sfx-countdown-go.mp3"))).toBe(true)
  })
})
