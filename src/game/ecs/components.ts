/**
 * Client ECS component records.
 * Each record maps entity id (number) → component data object.
 * Systems read and write these directly; no indirection layer needed at client scale.
 */

/** World-space position of a client entity. */
export const ClientPosition: Record<number, { x: number; y: number }> = {}

/**
 * Authoritative server snapshot for a player entity.
 * Updated by NetworkSyncSystem from PlayerDelta/PlayerSnapshot messages.
 */
export const ClientPlayerState: Record<
  number,
  {
    playerId: string
    username: string
    heroId: string
    health: number
    maxHealth: number
    lives: number
    animState: string
    facingAngle: number
    invulnerable: boolean
  }
> = {}

/**
 * Fireball projectile state.
 * Maintained by ProjectileRenderSystem.
 */
export const ClientFireball: Record<
  number,
  { x: number; y: number; vx: number; vy: number; ownerId: string }
> = {}

/**
 * Rendering interpolation state per player entity.
 * Stores the rendered (smoothed) position, separate from the authoritative server position.
 */
export const ClientRenderPos: Record<number, { x: number; y: number }> = {}
