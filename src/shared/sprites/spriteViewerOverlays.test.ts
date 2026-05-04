import { describe, expect, it } from "vitest"

import {
  CHARACTER_HITBOX_DOWN_PX,
  CHARACTER_HITBOX_LEFT_PX,
  CHARACTER_HITBOX_RIGHT_PX,
  CHARACTER_HITBOX_UP_PX,
  PLAYER_WORLD_COLLISION_OFFSET_Y_PX,
  PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
} from "@/shared/balance-config/combat"
import { LADY_WIZARD_CLIP_FPS, LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y } from "@/shared/sprites/ladyWizard"
import { PRIMARY_MELEE_ATTACK_CONFIGS } from "@/shared/balance-config/equipment"
import {
  SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX,
  SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX,
  SPRITE_VIEWER_DEFAULT_PRIMARY_ATTACK_ID,
  spriteViewerAttackHurtbox,
  spriteViewerCharacterHitbox,
  spriteViewerCenterpoint,
  spriteViewerCenterpointTooltip,
  spriteViewerDangerousFrameRange,
  spriteViewerDirectionToFacingRad,
  spriteViewerFrameIsDangerous,
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
      offsetY: PLAYER_WORLD_COLLISION_OFFSET_Y_PX,
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

describe("primary-attack hurtbox overlay helpers", () => {
  it("maps eight compass directions to canonical radians", () => {
    expect(spriteViewerDirectionToFacingRad("east")).toBeCloseTo(0)
    expect(spriteViewerDirectionToFacingRad("south")).toBeCloseTo(Math.PI / 2)
    expect(spriteViewerDirectionToFacingRad("west")).toBeCloseTo(Math.PI)
    expect(spriteViewerDirectionToFacingRad("north")).toBeCloseTo(-Math.PI / 2)
    expect(spriteViewerDirectionToFacingRad("south-east")).toBeCloseTo(Math.PI / 4)
    expect(spriteViewerDirectionToFacingRad("south-west")).toBeCloseTo((3 * Math.PI) / 4)
    expect(spriteViewerDirectionToFacingRad("north-east")).toBeCloseTo(-Math.PI / 4)
    expect(spriteViewerDirectionToFacingRad("north-west")).toBeCloseTo(-(3 * Math.PI) / 4)
  })

  it("falls back to east for an unknown direction", () => {
    expect(spriteViewerDirectionToFacingRad("bogus" as never)).toBe(0)
  })

  it("maps ms dangerous window to half-open frame range", () => {
    const cfg = { dangerousWindowStartMs: 300, dangerousWindowEndMs: 540 }
    expect(spriteViewerDangerousFrameRange(cfg, 12)).toEqual([3, 7])
  })

  it("returns [0,0] for non-positive fps", () => {
    const cfg = { dangerousWindowStartMs: 100, dangerousWindowEndMs: 500 }
    expect(spriteViewerDangerousFrameRange(cfg, 0)).toEqual([0, 0])
  })

  it("builds an attack hurtbox overlay from balance config and direction", () => {
    const fps = LADY_WIZARD_CLIP_FPS.summoned_axe_swing
    const overlay = spriteViewerAttackHurtbox(SPRITE_VIEWER_DEFAULT_PRIMARY_ATTACK_ID, "east", fps)
    const cfg = PRIMARY_MELEE_ATTACK_CONFIGS[SPRITE_VIEWER_DEFAULT_PRIMARY_ATTACK_ID]
    expect(overlay.radiusPx).toBe(cfg.hurtboxRadiusPx)
    expect(overlay.arcDeg).toBe(cfg.hurtboxArcDeg)
    expect(overlay.facingRad).toBeCloseTo(0)
    const [start, end] = spriteViewerDangerousFrameRange(cfg, fps)
    expect(overlay.dangerousStartFrame).toBe(start)
    expect(overlay.dangerousEndFrame).toBe(end)
  })

  it("flags frames inside the dangerous window and not those outside", () => {
    const overlay = { dangerousStartFrame: 3, dangerousEndFrame: 7 }
    expect(spriteViewerFrameIsDangerous(2, overlay)).toBe(false)
    expect(spriteViewerFrameIsDangerous(3, overlay)).toBe(true)
    expect(spriteViewerFrameIsDangerous(6, overlay)).toBe(true)
    expect(spriteViewerFrameIsDangerous(7, overlay)).toBe(false)
  })
})
