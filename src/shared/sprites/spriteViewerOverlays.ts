import {
  CHARACTER_HITBOX_DOWN_PX,
  CHARACTER_HITBOX_LEFT_PX,
  CHARACTER_HITBOX_RIGHT_PX,
  CHARACTER_HITBOX_UP_PX,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "@/shared/balance-config/combat"
import {
  PRIMARY_MELEE_ATTACK_CONFIGS,
  type PrimaryMeleeAttackConfig,
  type PrimaryMeleeAttackId,
} from "@/shared/balance-config/equipment"
import {
  LADY_WIZARD_DIRECTIONS,
  LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y,
  type LadyWizardDirection,
} from "@/shared/sprites/ladyWizard"

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

/** Default attack id used by the sprite viewer when previewing the primary-attack hurtbox. */
export const SPRITE_VIEWER_DEFAULT_PRIMARY_ATTACK_ID: PrimaryMeleeAttackId = "red_wizard_cleaver"

/** Atlas clip id whose dangerous-frames overlay reads from primary-melee balance config. */
export const SPRITE_VIEWER_PRIMARY_ATTACK_ATLAS_CLIP_ID = "summoned-axe-attack"

export type SpriteViewerHurtboxOverlay = {
  readonly radiusPx: number
  readonly arcDeg: number
  readonly facingRad: number
  readonly dangerousStartFrame: number
  readonly dangerousEndFrame: number
}

/**
 * Returns the radians equivalent of a megasheet direction.
 *
 * Canvas / sim convention: x east, y south. East = 0 rad, south = π/2 rad,
 * west = π rad, north = -π/2 rad. CCW positive.
 *
 * @param direction - Megasheet direction string (eight-compass).
 * @returns Facing angle in radians.
 */
export function spriteViewerDirectionToFacingRad(direction: LadyWizardDirection): number {
  const idx = LADY_WIZARD_DIRECTIONS.indexOf(direction)
  if (idx < 0) return 0
  // LADY_WIZARD_DIRECTIONS order: south, south-east, east, north-east, north, north-west, west, south-west.
  const angles: Record<LadyWizardDirection, number> = {
    south: Math.PI / 2,
    "south-east": Math.PI / 4,
    east: 0,
    "north-east": -Math.PI / 4,
    north: -Math.PI / 2,
    "north-west": -(3 * Math.PI) / 4,
    west: Math.PI,
    "south-west": (3 * Math.PI) / 4,
  }
  return angles[direction]
}

/**
 * Maps an attack's ms dangerous window to inclusive-start, exclusive-end frame
 * indices for the supplied animation FPS.
 *
 * @param config - Primary melee attack tuning.
 * @param fps - Animation frame rate.
 * @returns Tuple `[startFrame, endFrame)` (end exclusive).
 */
export function spriteViewerDangerousFrameRange(
  config: Pick<PrimaryMeleeAttackConfig, "dangerousWindowStartMs" | "dangerousWindowEndMs">,
  fps: number,
): readonly [number, number] {
  if (fps <= 0) return [0, 0]
  const start = Math.floor((config.dangerousWindowStartMs * fps) / 1000)
  const end = Math.ceil((config.dangerousWindowEndMs * fps) / 1000)
  return [start, end]
}

/**
 * Resolves the half-circle hurtbox overlay parameters for one cell of the dev viewer.
 *
 * @param attackId - Which hero's primary-melee attack to read tuning from.
 * @param direction - Facing direction of the displayed cell.
 * @param fps - Animation FPS used to map ms window → frame indices.
 * @returns Overlay descriptor (radius, arc, facing, dangerous frame range).
 */
export function spriteViewerAttackHurtbox(
  attackId: PrimaryMeleeAttackId,
  direction: LadyWizardDirection,
  fps: number,
): SpriteViewerHurtboxOverlay {
  const cfg = PRIMARY_MELEE_ATTACK_CONFIGS[attackId]
  const [start, end] = spriteViewerDangerousFrameRange(cfg, fps)
  return {
    radiusPx: cfg.hurtboxRadiusPx,
    arcDeg: cfg.hurtboxArcDeg,
    facingRad: spriteViewerDirectionToFacingRad(direction),
    dangerousStartFrame: start,
    dangerousEndFrame: end,
  }
}

/**
 * Returns whether a frame is inside an attack's dangerous window.
 *
 * @param frame - Zero-based frame index.
 * @param overlay - Overlay descriptor produced by {@link spriteViewerAttackHurtbox}.
 * @returns True when the frame is dangerous.
 */
export function spriteViewerFrameIsDangerous(
  frame: number,
  overlay: Pick<SpriteViewerHurtboxOverlay, "dangerousStartFrame" | "dangerousEndFrame">,
): boolean {
  return frame >= overlay.dangerousStartFrame && frame < overlay.dangerousEndFrame
}
