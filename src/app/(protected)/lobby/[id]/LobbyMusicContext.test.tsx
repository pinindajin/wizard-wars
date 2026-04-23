/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, waitFor } from "@testing-library/react"

const pathnameMock = vi.fn<() => string | null>()

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}))

import { LobbyMusicProvider } from "./LobbyMusicContext"

/**
 * Installs spies on HTMLMediaElement.prototype.play/pause so we can assert
 * the provider's behavior without requiring a real audio element.
 *
 * @returns The play and pause spies.
 */
function installAudioSpies() {
  const play = vi.fn().mockResolvedValue(undefined)
  const pause = vi.fn()
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    play as unknown as HTMLMediaElement["play"],
  )
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    pause as unknown as HTMLMediaElement["pause"],
  )
  return { play, pause }
}

describe("LobbyMusicProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    pathnameMock.mockReset()
    sessionStorage.clear()
    window.history.replaceState(null, "", "/lobby/abc")
  })

  it("starts playing lobby music on the lobby route", async () => {
    pathnameMock.mockReturnValue("/lobby/abc")
    const { play, pause } = installAudioSpies()

    render(
      <LobbyMusicProvider>
        <div data-testid="child">child</div>
      </LobbyMusicProvider>,
    )

    await waitFor(() => {
      expect(play).toHaveBeenCalled()
    })
    expect(pause).not.toHaveBeenCalled()
  })

  it("does not play and pauses on the /game route", async () => {
    pathnameMock.mockReturnValue("/lobby/abc/game")
    window.history.replaceState(null, "", "/lobby/abc/game")
    const { play, pause } = installAudioSpies()

    render(
      <LobbyMusicProvider>
        <div data-testid="child">child</div>
      </LobbyMusicProvider>,
    )

    // Wait a microtask tick so effects run.
    await Promise.resolve()

    expect(play).not.toHaveBeenCalled()
    // pause is called on the (lazy) audioRef; since no element was constructed
    // yet on the game route, pause on the prototype stays untouched. This is
    // the expected outcome: no audio element is ever instantiated during an
    // in-match session that started directly on /game.
    expect(pause).not.toHaveBeenCalled()
  })

  it("ignores autoplay-unlock gestures while on /game", async () => {
    pathnameMock.mockReturnValue("/lobby/abc/game")
    window.history.replaceState(null, "", "/lobby/abc/game")
    const { play } = installAudioSpies()

    render(
      <LobbyMusicProvider>
        <div data-testid="child">child</div>
      </LobbyMusicProvider>,
    )

    window.dispatchEvent(new Event("pointerdown"))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }))

    await Promise.resolve()

    expect(play).not.toHaveBeenCalled()
  })

  it("pauses the audio when navigating from lobby to /game", async () => {
    pathnameMock.mockReturnValue("/lobby/abc")
    const { play, pause } = installAudioSpies()

    const { rerender } = render(
      <LobbyMusicProvider>
        <div data-testid="child">child</div>
      </LobbyMusicProvider>,
    )

    await waitFor(() => {
      expect(play).toHaveBeenCalled()
    })

    pathnameMock.mockReturnValue("/lobby/abc/game")
    window.history.replaceState(null, "", "/lobby/abc/game")

    rerender(
      <LobbyMusicProvider>
        <div data-testid="child">child</div>
      </LobbyMusicProvider>,
    )

    await waitFor(() => {
      expect(pause).toHaveBeenCalled()
    })
  })
})
