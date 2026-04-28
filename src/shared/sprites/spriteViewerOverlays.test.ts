import { describe, expect, it } from "vitest"

import {
  CHARACTER_HITBOX_DOWN_PX,
  CHARACTER_HITBOX_LEFT_PX,
  CHARACTER_HITBOX_RIGHT_PX,
  CHARACTER_HITBOX_UP_PX,
  PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
} from "@/shared/balance-config/combat"
import { LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y } from "@/shared/sprites/ladyWizard"
import {
  SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX,
  SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX,
  spriteViewerCharacterHitbox,
  spriteViewerCenterpoint,
  spriteViewerCenterpointTooltip,
  spriteViewerMovementOvalRadii,
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
    expect(SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX).toBeLessThan(PLAYER_WORLD_COLLISION_RADIUS_X_PX)
  })

  it("exposes movement oval radii from balance config", () => {
    expect(spriteViewerMovementOvalRadii()).toEqual({
      radiusX: PLAYER_WORLD_COLLISION_RADIUS_X_PX,
      radiusY: PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
    })
  })

  it("places the combat hitbox around the sim anchor", () => {
    const point = spriteViewerCenterpoint()
    expect(spriteViewerCharacterHitbox()).toEqual({
      x: point.x - CHARACTER_HITBOX_LEFT_PX,
      y: point.y - CHARACTER_HITBOX_UP_PX,
      width: CHARACTER_HITBOX_LEFT_PX + CHARACTER_HITBOX_RIGHT_PX,
      height: CHARACTER_HITBOX_UP_PX + CHARACTER_HITBOX_DOWN_PX,
    })
  })

  it("describes centerpoint versus radius", () => {
    expect(spriteViewerCenterpointTooltip()).toBe(
      `Centerpoint is the authoritative Position.x/y sim anchor at (0, ${-LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y}) in detail-canvas coordinates. The movement oval and character hitbox are drawn around this point; they do not create the point.`,
    )
  })
})
