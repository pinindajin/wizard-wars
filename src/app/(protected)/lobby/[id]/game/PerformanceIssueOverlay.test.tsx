/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import PerformanceIssueOverlay from "./PerformanceIssueOverlay"

describe("PerformanceIssueOverlay", () => {
  it("renders nothing when there are no performance issues", () => {
    const { container } = render(<PerformanceIssueOverlay issues={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it("renders the warning icons in stable order without visible labels", () => {
    render(
      <PerformanceIssueOverlay
        issues={["rubberbanding", "server_cpu", "lost_connection"]}
      />,
    )

    const overlay = screen.getByTestId("performance-issue-overlay")
    expect(overlay.getAttribute("aria-label")).toBe("Performance warnings")
    expect(overlay.className).toContain("right-4")
    expect(overlay.className).toContain("top-4")
    expect(overlay.className).toContain("z-40")

    const cells = [
      screen.getByTestId("performance-issue-lost_connection"),
      screen.getByTestId("performance-issue-server_cpu"),
      screen.getByTestId("performance-issue-rubberbanding"),
    ]
    expect(cells.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "Connection issue",
      "Server loop degraded",
      "Rubber-banding detected",
    ])
    expect(overlay.textContent).toBe("")
    expect(
      cells.map((cell) => cell.querySelector("img")?.getAttribute("src")),
    ).toEqual([
      "/assets/game/performance/lost-connection.png",
      "/assets/game/performance/server-cpu.png",
      "/assets/game/performance/rubberbanding.png",
    ])
  })
})
