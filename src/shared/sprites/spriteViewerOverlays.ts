import {
  CHARACTER_HITBOX_DOWN_PX,
  CHARACTER_HITBOX_LEFT_PX,
  CHARACTER_HITBOX_RIGHT_PX,
  CHARACTER_HITBOX_UP_PX,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "@/shared/balance-config/combat"
import { LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y } from "@/shared/sprites/ladyWizard"

/** Centerpoint marker radius in detail-canvas world pixels. */
export const SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX = 2

/** Centerpoint marker arm length in detail-canvas world pixels. */
export const SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX = 5

export type SpriteViewerCenterpoint = {
  readonly x: number
  readonly y: number
}

export type SpriteViewerRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type SpriteViewerOvalRadii = {
  readonly radiusX: number
  readonly radiusY: number
  readonly offsetY: number
}

/**
 * Returns the sim/render anchor location in sprite-detail local coordinates.
 *
 * The detail canvas draws the texture with bottom-center at `(0, 0)`. Gameplay
 * collision is centered on the sim anchor, which is texture bottom minus the
 * Phaser display Y offset.
 */
export function spriteViewerCenterpoint(): SpriteViewerCenterpoint {
  return { x: 0, y: -LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y }
}

/**
 * Returns the oval world-collision radii shown in the sprite viewer.
 *
 * @returns Axis-aligned movement oval radii in detail-canvas world pixels.
 */
export function spriteViewerMovementOvalRadii(): SpriteViewerOvalRadii {
  return PLAYER_WORLD_COLLISION_FOOTPRINT
}

/**
 * Returns the character combat hitbox in sprite-detail local coordinates.
 *
 * @returns Axis-aligned combat hitbox rectangle in detail-canvas world pixels.
 */
export function spriteViewerCharacterHitbox(): SpriteViewerRect {
  const point = spriteViewerCenterpoint()
  return {
    x: point.x - CHARACTER_HITBOX_LEFT_PX,
    y: point.y - CHARACTER_HITBOX_UP_PX,
    width: CHARACTER_HITBOX_LEFT_PX + CHARACTER_HITBOX_RIGHT_PX,
    height: CHARACTER_HITBOX_UP_PX + CHARACTER_HITBOX_DOWN_PX,
  }
}

/** Human-readable tooltip copy for the centerpoint legend row. */
export function spriteViewerCenterpointTooltip(): string {
  const point = spriteViewerCenterpoint()
  return `Centerpoint is the authoritative Position.x/y sim anchor at (${point.x}, ${point.y}) in detail-canvas coordinates. The movement oval and character hitbox are drawn around this point; they do not create the point.`
}
