/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"

import GameSettingsModal from "./GameSettingsModal"
import {
  GameSettingsProvider,
  useGameSettingsContext,
} from "./GameSettingsContext"

const updateSettings = vi.fn()
const me = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock("@/lib/trpc", () => ({
  createTrpcClient: () => ({
    user: {
      me: { query: me },
      updateSettings: { mutate: updateSettings },
    },
  }),
}))

function renderWithSettings(children: React.ReactNode) {
  return render(<GameSettingsProvider>{children}</GameSettingsProvider>)
}

describe("GameSettings debug mode", () => {
  beforeEach(() => {
    me.mockResolvedValue({ user: null })
    updateSettings.mockResolvedValue({})
    me.mockClear()
    updateSettings.mockClear()
  })

  it("defaults debug mode to off in memory", () => {
    me.mockReturnValue(new Promise(() => {}))

    function Probe() {
      const { debugModeEnabled } = useGameSettingsContext()
      return <span data-testid="debug-value">{String(debugModeEnabled)}</span>
    }

    renderWithSettings(<Probe />)

    expect(screen.getByTestId("debug-value").textContent).toBe("false")
  })

  it("does not persist debug mode when settings are saved", async () => {
    renderWithSettings(
      <GameSettingsModal
        onClose={() => {}}
        onApplyAudioVolumes={() => {}}
      />,
    )

    const debugToggle = await screen.findByTestId("settings-debug-mode")
    fireEvent.click(debugToggle)
    fireEvent.click(screen.getByTestId("settings-save"))

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1))
    expect(updateSettings.mock.calls[0]?.[0]).not.toHaveProperty("debugModeEnabled")
  })
})
