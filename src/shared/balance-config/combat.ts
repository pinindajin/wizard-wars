import { combineDamageProperties, DamageProperty } from "./damage"

/** Default player HP at match start. */
export const DEFAULT_PLAYER_HEALTH = 100

/** Lives each player starts a match with. */
export const STARTING_LIVES = 5

/** Player-player collision radius in pixels. World collision uses the oval footprint constants below. */
export const PLAYER_RADIUS_PX = 20

/** Horizontal radius of the player's oval world-collision footprint in pixels. */
export const PLAYER_WORLD_COLLISION_RADIUS_X_PX = 20

/** Vertical radius of the player's oval world-collision footprint in pixels. */
export const PLAYER_WORLD_COLLISION_RADIUS_Y_PX = 9

/** Vertical offset from the sim anchor to the oval world-collision center in pixels. */
export const PLAYER_WORLD_COLLISION_OFFSET_Y_PX = 8

/** Complete player oval footprint used for world collision. */
export const PLAYER_WORLD_COLLISION_FOOTPRINT = {
  radiusX: PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  radiusY: PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
  offsetY: PLAYER_WORLD_COLLISION_OFFSET_Y_PX,
} as const

/** Character combat hitbox extent to the left of the sim anchor in pixels. */
export const CHARACTER_HITBOX_LEFT_PX = 15

/** Character combat hitbox extent to the right of the sim anchor in pixels. */
export const CHARACTER_HITBOX_RIGHT_PX = 15

/** Character combat hitbox extent above the sim anchor in pixels. */
export const CHARACTER_HITBOX_UP_PX = 40

/** Character combat hitbox extent below the sim anchor in pixels. */
export const CHARACTER_HITBOX_DOWN_PX = 15

/** Base movement speed in pixels per second. */
export const BASE_MOVE_SPEED_PX_PER_SEC = 200

/** Movement speed multiplier while swinging a weapon. */
export const SWING_MOVE_SPEED_MULTIPLIER = 0.35

/** Duration of the red damage flash on a player sprite, in ms. */
export const DAMAGE_FLASH_MS = 150

/** Total respawn delay in ms (includes death animation). */
export const RESPAWN_DELAY_MS = 3000

/**
 * Fallback duration of the death animation in ms.
 * Runtime death animation timing is loaded from `src/shared/balance-config/animation-config.json`.
 */
export const DEATH_ANIM_MS = 800

/** Duration of the invulnerability window after respawn, in ms. */
export const INVULNERABLE_WINDOW_MS = 1500

/** Player renders at this alpha during invulnerability. */
export const INVULNERABLE_ALPHA = 0.5

/** Invulnerability pulse: oscillate alpha from INVULNERABLE_ALPHA to this value at 4 Hz. */
export const INVULNERABLE_ALPHA_PEAK = 0.75

/** How many pixels of knockback Fireball applies to the target. */
export const FIREBALL_KNOCKBACK_PX = 50

/** Duration of the axe hitbox TTL in ms. */
export const AXE_HIT_TTL_MS = 120

// --- Fireball ---
/** Damage dealt by a fireball. Bitmask: Magic | Fire. */
export const FIREBALL_DAMAGE = 20
export const FIREBALL_DAMAGE_PROPERTIES = combineDamageProperties(
  DamageProperty.Magic,
  DamageProperty.Fire,
)
/** Fireball projectile speed in px/s. */
export const FIREBALL_SPEED_PX_PER_SEC = 400
/**
 * Default fireball cast animation lock duration.
 * Runtime cast timing is loaded from `src/shared/balance-config/animation-config.json`.
 */
export const FIREBALL_CAST_MS = 500
/** Fireball cooldown after cast animation finishes. */
export const FIREBALL_COOLDOWN_MS = 800
/** Newly launched fireballs ignore their owner for this many ms. */
export const FIREBALL_OWNER_SELF_DAMAGE_GRACE_MS = 100

// --- Lightning Bolt ---
/** Damage dealt by lightning bolt. Bitmask: Magic | Electric. */
export const LIGHTNING_BOLT_DAMAGE = 40
export const LIGHTNING_BOLT_DAMAGE_PROPERTIES = combineDamageProperties(
  DamageProperty.Magic,
  DamageProperty.Electric,
)
/** Length of the lightning bolt main arc in px. */
export const LIGHTNING_BOLT_ARC_PX = 350
/** Hit radius around the main arc for AOE damage. */
export const LIGHTNING_HIT_RADIUS_PX = 40
/**
 * Default lightning cast animation lock duration.
 * Runtime cast timing is loaded from `src/shared/balance-config/animation-config.json`.
 */
export const LIGHTNING_CAST_MS = 700
/** Lightning cooldown after cast animation finishes. */
export const LIGHTNING_COOLDOWN_MS = 4000

// --- Jump (shop ability) ---
/** Gravity applied to vertical jump velocity (world px/s²). */
export const JUMP_GRAVITY_PX_PER_SEC2 = 2400
/** Initial upward velocity when a jump begins (world px/s). */
export const JUMP_INITIAL_VZ_PX_PER_SEC = 600
/** Ability cooldown starting when jump is accepted (ms). */
export const JUMP_COOLDOWN_MS = 2500
/**
 * Minimum simulated `jumpZ` (px) to treat the player as airborne for collider splitting.
 * Must stay consistent across server movement, world resolve, and client replay (r5).
 */
export const JUMP_AIRBORNE_COLLIDER_EPSILON_PX = 4
/** Client sprite vertical offset per unit of server `jumpZ` (world px → screen px). */
export const JUMP_SPRITE_Y_PIXELS_PER_SIM_Z = 1

// --- Terrain hazards ---
/** Damage applied while the player's footprint is in lava, in HP per second. */
export const LAVA_DAMAGE_PER_SECOND = 10

/** Forced slide speed while a player is stumbling on a cliff, in px/s. */
export const CLIFF_SLIDE_SPEED_PX_PER_SEC = 10

/** Number of frames in the stumble clip. */
export const STUMBLE_ANIM_FRAME_COUNT = 17

/** Lava lap spritesheet frame dimensions. */
export const LAVA_LAP_FRAME_WIDTH_PX = 64
export const LAVA_LAP_FRAME_HEIGHT_PX = 32
export const LAVA_LAP_FRAME_COUNT = 6
export const LAVA_LAP_ANIM_FPS = 8

// --- Axe ---
/** Damage dealt by the axe swing. Bitmask: Physical | Slashing. */
export const AXE_DAMAGE = 30
export const AXE_DAMAGE_PROPERTIES = combineDamageProperties(
  DamageProperty.Physical,
  DamageProperty.Slashing,
)
/** Hurtbox radius in pixels. Half-circle extends this far in front of the attacker. */
export const AXE_HURTBOX_RADIUS_PX = 45
/** Hurtbox arc width in degrees. 180 = half-circle (flat side at character, curve facing forward). */
export const AXE_HURTBOX_ARC_DEG = 180
/**
 * Default axe swing animation duration in ms.
 * Runtime primary-attack timing is loaded from `src/shared/balance-config/animation-config.json`.
 */
export const AXE_SWING_DURATION_MS = 1417
/**
 * Default dangerous-window start.
 * Runtime primary-attack timing is loaded from `src/shared/balance-config/animation-config.json`.
 */
export const AXE_DANGEROUS_WINDOW_START_MS = 500
/**
 * Default dangerous-window end.
 * Runtime primary-attack timing is loaded from `src/shared/balance-config/animation-config.json`.
 */
export const AXE_DANGEROUS_WINDOW_END_MS = 900

// --- Healing Potion ---
/** HP restored by a healing potion. */
export const HEALING_POTION_HP = 50
/** Healing potion cast animation lock duration. */
export const HEALING_POTION_CAST_MS = 300

// --- Swift Boots ---
/** Move speed bonus from Swift Boots (flat multiplier, non-stackable). */
export const SWIFT_BOOTS_SPEED_BONUS = 0.1
