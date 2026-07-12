/** @vitest-environment jsdom */
import "@testing-library/jest-dom"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HERO_CARD_CONFIGS, HeroCard } from "./HeroCard"

describe("HeroCard", () => {
  it("defines Yen, Triss, and Helena cards with hero-specific portraits", () => {
    expect(Object.keys(HERO_CARD_CONFIGS)).toEqual(["yen", "triss", "helena"])
    expect(HERO_CARD_CONFIGS.yen).toMatchObject({
      id: "yen",
      displayName: "Yen",
      portraitUrl: "/assets/sprites/heroes/lady-wizard/sheets/idle-south.png",
      portraitSheetWidth: 640,
    })
    expect(HERO_CARD_CONFIGS.triss).toMatchObject({
      id: "triss",
      displayName: "Triss",
      portraitUrl: "/assets/sprites/heroes/triss/sheets/idle-south.png",
      portraitSheetWidth: 160,
    })
    expect(HERO_CARD_CONFIGS.helena).toMatchObject({
      id: "helena",
      displayName: "Helena",
      accent: "#3b82f6",
      portraitUrl: "/assets/sprites/heroes/helena/sheets/idle-south.png",
      portraitSheetWidth: 160,
    })
  })

  it("renders selected state and selects by canonical hero id", () => {
    const onSelect = vi.fn()

    render(<HeroCard config={HERO_CARD_CONFIGS.triss} selected onSelect={onSelect} />)

    expect(screen.getByText("Triss")).toBeInTheDocument()
    expect(screen.getByText("Selected")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button"))

    expect(onSelect).toHaveBeenCalledWith("triss")
  })

  it("does not select disabled cards", () => {
    const onSelect = vi.fn()

    render(<HeroCard config={HERO_CARD_CONFIGS.yen} selected={false} onSelect={onSelect} disabled />)

    expect(screen.getByRole("button")).toBeDisabled()
    fireEvent.click(screen.getByRole("button"))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
