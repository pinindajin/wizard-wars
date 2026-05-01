/**
 * All bitECS 0.4 component definitions for Wizard Wars.
 *
 * Components with numeric fields are plain objects whose values are typed arrays
 * (SoA layout). Each array is indexed by entity ID. Tags are empty plain objects
 * whose *presence* on an entity is the only information they carry.
 *
 * MAX_ENTITIES is deliberately generous; at 12 players + many projectiles the
 * actual count is orders of magnitude lower.
 */

/** Maximum entity slots allocated for typed-array components. */
export const MAX_ENTITIES = 10_000

// ─── Numeric components ───────────────────────────────────────────────────

/** World-space position in pixels. */
export const Position = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
}

/** World-space velocity in pixels-per-second (applied per-tick by movement systems). */
export const Velocity = {
  vx: new Float32Array(MAX_ENTITIES),
  vy: new Float32Array(MAX_ENTITIES),
}

/** Facing direction in radians (0 = east, CCW positive). */
export const Facing = {
  angle: new Float32Array(MAX_ENTITIES),
}

/**
 * Body / locomotion facing in radians (last non-zero WASD intent).
 * Updated only when move intent is non-zero; idle keeps the previous value.
 */
export const MoveFacing = {
  angle: new Float32Array(MAX_ENTITIES),
}

/** Player-player collision circle radius in pixels; world/combat use separate shared footprints. */
export const Radius = {
  r: new Float32Array(MAX_ENTITIES),
}

/** Hit-point pool. */
export const Health = {
  current: new Float32Array(MAX_ENTITIES),
  max: new Float32Array(MAX_ENTITIES),
}

/** Lives remaining before spectator mode. */
export const Lives = {
  count: new Uint32Array(MAX_ENTITIES),
}

/** Gold amount owned by a player. */
export const Gold = {
  amount: new Uint32Array(MAX_ENTITIES),
}

/**
 * Hero type index into {@link HERO_INDEX_TO_ID}.
 * Stored as a number because ECS components cannot hold strings.
 */
export const Hero = {
  typeIndex: new Uint32Array(MAX_ENTITIES),
}

/**
 * Active cast state.
 * @field abilityIndex          - Index into {@link ABILITY_INDEX_TO_ID}
 * @field startedAtTick         - Simulation tick when the cast input was accepted
 * @field animationEndsAtTick   - First simulation tick at/after configured animation duration
 * @field effectFiresAtTick     - First simulation tick at/after configured effect timing
 * @field effectFired           - 1 once the spell/consumable effect has been applied
 * @field quick                 - 1 = caster may move during cast; 0 = movement locked
 * @field captured*             - Aim/position snapshot captured at cast press for deterministic release
 */
export const Casting = {
  abilityIndex: new Int32Array(MAX_ENTITIES),
  startedAtTick: new Uint32Array(MAX_ENTITIES),
  animationEndsAtTick: new Uint32Array(MAX_ENTITIES),
  effectFiresAtTick: new Uint32Array(MAX_ENTITIES),
  effectFired: new Uint8Array(MAX_ENTITIES),
  quick: new Uint8Array(MAX_ENTITIES),
  capturedPositionX: new Float32Array(MAX_ENTITIES),
  capturedPositionY: new Float32Array(MAX_ENTITIES),
  capturedFacingAngle: new Float32Array(MAX_ENTITIES),
  capturedTargetX: new Float32Array(MAX_ENTITIES),
  capturedTargetY: new Float32Array(MAX_ENTITIES),
}

/** Applied knockback impulse; decremented each tick until exhausted. */
export const Knockback = {
  impulseX: new Float32Array(MAX_ENTITIES),
  impulseY: new Float32Array(MAX_ENTITIES),
  remainingPx: new Float32Array(MAX_ENTITIES),
}

/**
 * Active jump arc: simulated height `z` (world px) and vertical velocity `vz`.
 * Horizontal movement uses the same WASD path as on the ground while airborne.
 */
export const JumpArc = {
  z: new Float32Array(MAX_ENTITIES),
  vz: new Float32Array(MAX_ENTITIES),
}

/** Current terrain hazard state: 0 land, 1 lava, 2 cliff. */
export const TerrainState = {
  kind: new Uint8Array(MAX_ENTITIES),
  /** Fractional lava damage carried across ticks until it reaches whole HP. */
  lavaDamageCarry: new Float32Array(MAX_ENTITIES),
}

/**
 * Per-ability cooldown stored as the *simulation tick* at which the ability
 * becomes ready. Ready when `currentTick >= Cooldown.<ability>[eid]`.
 */
export const Cooldown = {
  fireball: new Uint32Array(MAX_ENTITIES),
  lightningBolt: new Uint32Array(MAX_ENTITIES),
  /** Primary melee swing end tick (was legacy `axe` cooldown array). */
  primaryMelee: new Uint32Array(MAX_ENTITIES),
  healingPotion: new Uint32Array(MAX_ENTITIES),
  jump: new Uint32Array(MAX_ENTITIES),
}

/** Post-respawn invulnerability; expires at this simulation tick. */
export const Invulnerable = {
  expiresAtTick: new Uint32Array(MAX_ENTITIES),
}

/** Damage-flash visual timer; expires at this server-time ms value. */
export const DamageFlash = {
  expiresAtMs: new Float64Array(MAX_ENTITIES),
}

/**
 * Death-animation timer.  Presence on entity means it is currently playing
 * the death animation.  When `serverTimeMs >= expiresAtMs`, deathSystem
 * replaces this component with {@link DeadTag}.
 */
export const DyingTag = {
  expiresAtMs: new Float64Array(MAX_ENTITIES),
}

/** Pending respawn timer with pre-computed spawn destination. */
export const RespawnTimer = {
  fireAtMs: new Float64Array(MAX_ENTITIES),
  spawnX: new Float32Array(MAX_ENTITIES),
  spawnY: new Float32Array(MAX_ENTITIES),
  facingAngle: new Float32Array(MAX_ENTITIES),
}

/**
 * Equipment and loadout indices.
 * `primaryMeleeAttackIndex` stores {@link PRIMARY_MELEE_ATTACK_IDS} index for the hero's cleaver attack.
 */
export const Equipment = {
  /** Index into hero primary melee attack ids; -1 if unset (should not happen for players). */
  primaryMeleeAttackIndex: new Int32Array(MAX_ENTITIES),
  hasSwiftBoots: new Uint8Array(MAX_ENTITIES),
}

/**
 * Ability-bar slot assignments (slot 0–4).
 * Each value is an {@link ABILITY_INDEX} integer, or -1 if the slot is empty.
 */
export const AbilitySlots = {
  slot0: new Int32Array(MAX_ENTITIES),
  slot1: new Int32Array(MAX_ENTITIES),
  slot2: new Int32Array(MAX_ENTITIES),
  slot3: new Int32Array(MAX_ENTITIES),
  slot4: new Int32Array(MAX_ENTITIES),
}

/**
 * Quick-item slots (Q, 6, 7, 8).
 * Each slot stores an {@link ITEM_INDEX} integer (-1 = empty) and a charge count.
 */
export const QuickItemSlots = {
  slot0Item: new Int32Array(MAX_ENTITIES),
  slot0Charges: new Uint8Array(MAX_ENTITIES),
  slot1Item: new Int32Array(MAX_ENTITIES),
  slot1Charges: new Uint8Array(MAX_ENTITIES),
  slot2Item: new Int32Array(MAX_ENTITIES),
  slot2Charges: new Uint8Array(MAX_ENTITIES),
  slot3Item: new Int32Array(MAX_ENTITIES),
  slot3Charges: new Uint8Array(MAX_ENTITIES),
}

/** Last-processed player input for the current tick. */
export const PlayerInput = {
  up: new Uint8Array(MAX_ENTITIES),
  down: new Uint8Array(MAX_ENTITIES),
  left: new Uint8Array(MAX_ENTITIES),
  right: new Uint8Array(MAX_ENTITIES),
  weaponPrimary: new Uint8Array(MAX_ENTITIES),
  weaponSecondary: new Uint8Array(MAX_ENTITIES),
  /** 0–4 = ability-bar slot to cast; -1 = no cast this tick. */
  abilitySlot: new Int8Array(MAX_ENTITIES),
  abilityTargetX: new Float32Array(MAX_ENTITIES),
  abilityTargetY: new Float32Array(MAX_ENTITIES),
  weaponTargetX: new Float32Array(MAX_ENTITIES),
  weaponTargetY: new Float32Array(MAX_ENTITIES),
  /** 0–3 = quick-item slot to use; -1 = none. */
  useQuickItemSlot: new Int8Array(MAX_ENTITIES),
  seq: new Uint32Array(MAX_ENTITIES),
}

/**
 * Generic ownership reference from a child entity to its owning entity.
 * Used by projectiles to record their caster's entity ID.
 */
export const Ownership = {
  ownerEid: new Uint32Array(MAX_ENTITIES),
}

// ─── Tag components (presence = true, no data fields) ─────────────────────

/** Marks an entity as a player character. */
export const PlayerTag = {}

/** Marks an entity as any kind of projectile. */
export const ProjectileTag = {}

/** Marks an entity as a fireball projectile. */
export const FireballTag = {}

/** Marks an entity as an axe-swing hitbox. */
export const AxeHitboxTag = {}

/** Marks a player entity as dead and awaiting respawn or spectator transition. */
export const DeadTag = {}

/** Marks a player entity that has spent all lives; now a spectator. */
export const SpectatorTag = {}

/** Visual-only damage-flash presence marker. */
export const DamageFlashTag = {}

/** Marks a player entity as currently mid axe swing (movement slow applied). */
export const SwingingWeapon = {}

/** Marks a player entity as currently invulnerable after respawn. */
export const InvulnerableTag = {}

export const TERRAIN_KIND = {
  land: 0,
  lava: 1,
  cliff: 2,
} as const

export const TERRAIN_KIND_TO_STATE = ["land", "lava", "cliff"] as const

// ─── Index ↔ ID mappings ─────────────────────────────────────────────────

/**
 * Maps ability string IDs to the integer `abilityIndex` stored in
 * {@link AbilitySlots} and {@link Casting} components.
 */
export const ABILITY_INDEX = {
  fireball: 0,
  lightning_bolt: 1,
  axe: 2,
  healing_potion: 3,
  jump: 4,
} as const

/** Reverse lookup: abilityIndex → ability ID string. */
export const ABILITY_INDEX_TO_ID: readonly string[] = [
  "fireball",
  "lightning_bolt",
  "axe",
  "healing_potion",
  "jump",
]

/** Maps hero string IDs to the integer stored in {@link Hero}.typeIndex. */
export const HERO_INDEX: Record<string, number> = {
  red_wizard: 0,
  barbarian: 1,
  ranger: 2,
}

/** Reverse lookup: Hero.typeIndex → hero ID string. */
export const HERO_INDEX_TO_ID: readonly string[] = ["red_wizard", "barbarian", "ranger"]

/** Maps quick-item string IDs to the integer stored in QuickItemSlots.slotNItem. */
export const ITEM_INDEX: Record<string, number> = {
  healing_potion: 0,
}

/** Reverse lookup: itemIndex → item ID string. */
export const ITEM_INDEX_TO_ID: readonly string[] = ["healing_potion"]
