/** @vitest-environment jsdom */
import "@testing-library/jest-dom"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, fireEvent } from "@testing-library/react"

import { LobbyIdlePill } from "./LobbyIdlePill"
import { LOBBY_IDLE_TIMEOUT_MS, LOBBY_IDLE_WARNING_THRESHOLD_MS } from "@/shared/balance-config/lobby"

describe("LobbyIdlePill", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("shows red Closing countdown under threshold and green Lobby AFK Time on click", async () => {
    const expiresAt = Date.now() + LOBBY_IDLE_WARNING_THRESHOLD_MS - 5000

    render(
      <LobbyIdlePill phase="LOBBY" lobbyIdleExpiresAtServerMs={expiresAt} />,
    )

    const redBtn = screen.getByRole("button", { name: /Lobby closes in/i })
    expect(redBtn).toBeInTheDocument()
    expect(screen.getByText("Closing")).toBeInTheDocument()

    fireEvent.click(redBtn)

    expect(screen.getByText("Lobby AFK Time")).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(LOBBY_IDLE_TIMEOUT_MS + 2000)
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(screen.queryByText("Lobby AFK Time")).not.toBeInTheDocument()
  })
})
