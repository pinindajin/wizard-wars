import { combineDamageProperties, DamageProperty } from "./damage"

/** Default player HP at match start. */
export const DEFAULT_PLAYER_HEALTH = 100

/** Lives each player starts a match with. */
export const STARTING_LIVES = 5

/** Player collision radius in pixels. */
export const PLAYER_RADIUS_PX = 20

/** Base movement speed in pixels per second. */
export const BASE_MOVE_SPEED_PX_PER_SEC = 200

/** Movement speed multiplier while swinging a weapon. */
export const SWING_MOVE_SPEED_MULTIPLIER = 0.35

/** Duration of the red damage flash on a player sprite, in ms. */
export const DAMAGE_FLASH_MS = 150

/** Total respawn delay in ms (includes death animation). */
export const RESPAWN_DELAY_MS = 3000

/** Duration of the death animation in ms. */
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
/** Fireball cast animation lock duration (non-Quick). */
export const FIREBALL_CAST_MS = 500
/** Fireball cooldown after cast animation finishes. */
export const FIREBALL_COOLDOWN_MS = 800

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
/** Lightning cast animation lock duration (non-Quick). */
export const LIGHTNING_CAST_MS = 700
/** Lightning cooldown after cast animation finishes. */
export const LIGHTNING_COOLDOWN_MS = 4000

// --- Axe ---
/** Damage dealt by the axe swing. Bitmask: Physical | Slashing. */
export const AXE_DAMAGE = 30
export const AXE_DAMAGE_PROPERTIES = combineDamageProperties(
  DamageProperty.Physical,
  DamageProperty.Slashing,
)
/** Axe swing arc in degrees (cone in front of player). */
export const AXE_SWING_ARC_DEG = 90
/** Axe swing radius in px. */
export const AXE_SWING_RADIUS_PX = 80
/** Axe swing animation duration in ms (= cooldown). */
export const AXE_SWING_DURATION_MS = 400

// --- Healing Potion ---
/** HP restored by a healing potion. */
export const HEALING_POTION_HP = 50
/** Healing potion cast animation lock duration. */
export const HEALING_POTION_CAST_MS = 300

// --- Swift Boots ---
/** Move speed bonus from Swift Boots (flat multiplier, non-stackable). */
export const SWIFT_BOOTS_SPEED_BONUS = 0.1
