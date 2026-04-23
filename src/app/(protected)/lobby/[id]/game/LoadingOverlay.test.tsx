/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import LoadingOverlay from "./LoadingOverlay"
import type { LoaderStatus } from "@/game/loaderStatus"

describe("LoadingOverlay", () => {
  it("renders a Starting game label when status is null", () => {
    render(<LoadingOverlay status={null} />)
    const label = screen.getByTestId("game-loading-label")
    expect(label.textContent).toBe("Loading Starting game [0/0]")
  })

  it("renders `Loading {description} [loaded/total]` from status", () => {
    const status: LoaderStatus = {
      scene: "Arena",
      description: "Arena assets",
      fileKey: "lady-wizard",
      loaded: 3,
      total: 10,
      phase: "loading",
    }
    render(<LoadingOverlay status={status} />)
    const label = screen.getByTestId("game-loading-label")
    expect(label.textContent).toBe("Loading Arena assets [3/10]")
  })

  it("opaque root has pointer-events-auto and z-50 and catches click events", () => {
    render(<LoadingOverlay status={null} />)
    const root = screen.getByTestId("game-loading-overlay")
    expect(root.className).toContain("pointer-events-auto")
    expect(root.className).toContain("z-50")

    // Click on the overlay — handler calls stopPropagation so the bubble
    // event never reaches document.body.
    const bubbled = { seen: false }
    document.addEventListener(
      "click",
      () => {
        bubbled.seen = true
      },
      { capture: false },
    )
    fireEvent.click(root)
    expect(bubbled.seen).toBe(false)
  })

  it("progress bar width reflects loaded/total ratio", () => {
    const status: LoaderStatus = {
      scene: "Boot",
      description: "Boot",
      fileKey: "",
      loaded: 1,
      total: 4,
      phase: "loading",
    }
    render(<LoadingOverlay status={status} />)
    const bar = screen.getByTestId("game-loading-bar") as HTMLElement
    expect(bar.style.width).toBe("25%")
  })
})
