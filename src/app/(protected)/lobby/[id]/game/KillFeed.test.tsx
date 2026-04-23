/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import KillFeed from "./KillFeed"

describe("KillFeed", () => {
  it("renders feed rows", () => {
    render(
      <KillFeed
        entries={[
          { key: "a", text: "K eliminated V (Fireball)" },
          { key: "b", text: "X died (unknown)" },
        ]}
      />,
    )
    expect(screen.getByTestId("kill-feed")).toBeTruthy()
    expect(screen.getByText("K eliminated V (Fireball)")).toBeTruthy()
    expect(screen.getByText("X died (unknown)")).toBeTruthy()
  })

  it("renders nothing when empty", () => {
    const { container } = render(<KillFeed entries={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
