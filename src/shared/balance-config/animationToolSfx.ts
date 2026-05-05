import { ABILITY_CONFIGS } from "./abilities"
import { SFX_KEYS } from "./audio"
import { PRIMARY_MELEE_ATTACK_CONFIGS, type PrimaryMeleeAttackId } from "./equipment"
import { HERO_CONFIGS } from "./heroes"
import type { AnimationActionId } from "./animationConfig"
import { primaryAttackActionId } from "./animationConfig"

/**
 * Returns the Phaser audio cache key (`sfx-…`) used for gameplay SFX for a hero animation
 * action shown in the animation tool, or `null` when no single SFX key is defined in balance
 * config (e.g. idle/death have no `castSfxKey` / swing mapping here; walk maps to footstep key).
 *
 * @param heroId - Lobby hero id (must exist in `HERO_CONFIGS` or result is `null`).
 * @param actionId - Animation tool action id (`spell:…`, `primary:…`, or behavior ids).
 * @returns Phaser SFX key string, or `null` if unmapped / unknown hero / mismatched primary id.
 */
export function resolveSfxKeyForAction(heroId: string, actionId: AnimationActionId): string | null {
  const hero = HERO_CONFIGS[heroId]
  if (!hero) return null

  if (actionId.startsWith("spell:")) {
    const abilityId = actionId.slice("spell:".length)
    const cfg = ABILITY_CONFIGS[abilityId]
    return cfg?.castSfxKey ?? null
  }

  if (actionId.startsWith("primary:")) {
    const attackId = actionId.slice("primary:".length) as PrimaryMeleeAttackId
    if (primaryAttackActionId(hero.primaryMeleeAttackId) !== actionId) {
      return null
    }
    const melee = PRIMARY_MELEE_ATTACK_CONFIGS[attackId]
    return melee?.swingSfxKey ?? null
  }

  if (actionId === "walk") {
    return SFX_KEYS.walkStep
  }

  // Other behavior clips (idle, death, stumble, …) — no single balance-config SFX key here.
  return null
}
