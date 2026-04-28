import { describe, expect, it } from "vitest"

import { PLAYER_RADIUS_PX } from "@/shared/balance-config/combat"
import { LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y } from "@/shared/sprites/ladyWizard"
import {
  SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX,
  SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX,
  spriteViewerCenterpoint,
  spriteViewerCenterpointTooltip,
} from "./spriteViewerOverlays"

describe("sprite viewer overlays", () => {
  it("places the centerpoint at the sim anchor in detail-canvas local coordinates", () => {
    expect(spriteViewerCenterpoint()).toEqual({
      x: 0,
      y: -LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y,
    })
  })

  it("keeps marker dimensions positive and compact", () => {
    expect(SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX).toBeGreaterThan(0)
    expect(SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX).toBeGreaterThan(
      SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX,
    )
    expect(SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX).toBeLessThan(PLAYER_RADIUS_PX)
  })

  it("describes centerpoint versus radius", () => {
    expect(spriteViewerCenterpointTooltip()).toBe(
      `Centerpoint is the authoritative Position.x/y sim anchor at (0, ${-LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y}) in detail-canvas coordinates. PLAYER_RADIUS_PX (${PLAYER_RADIUS_PX}px) is drawn around this point; it does not create the point.`,
    )
  })
})
