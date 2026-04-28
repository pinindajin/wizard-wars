import { PLAYER_RADIUS_PX } from "@/shared/balance-config/combat"
import { LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y } from "@/shared/sprites/ladyWizard"

/** Centerpoint marker radius in detail-canvas world pixels. */
export const SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX = 2

/** Centerpoint marker arm length in detail-canvas world pixels. */
export const SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX = 5

export type SpriteViewerCenterpoint = {
  readonly x: number
  readonly y: number
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

/** Human-readable tooltip copy for the centerpoint legend row. */
export function spriteViewerCenterpointTooltip(): string {
  const point = spriteViewerCenterpoint()
  return `Centerpoint is the authoritative Position.x/y sim anchor at (${point.x}, ${point.y}) in detail-canvas coordinates. PLAYER_RADIUS_PX (${PLAYER_RADIUS_PX}px) is drawn around this point; it does not create the point.`
}
