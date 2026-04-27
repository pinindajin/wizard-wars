import { ABILITY_CONFIGS } from "@/shared/balance-config/abilities"
import { PRIMARY_MELEE_ATTACK_CONFIGS } from "@/shared/balance-config/equipment"
import type { PlayerDeathPayload } from "@/shared/types"

/**
 * Human-readable label for a `killerAbilityId` from the combat sim.
 *
 * @param abilityId - Ability id or null.
 * @returns Short label for the kill feed.
 */
export function killFeedAbilityLabel(abilityId: string | null): string {
  if (!abilityId) return "unknown"
  const cfg = ABILITY_CONFIGS[abilityId]
  if (cfg) return cfg.displayName
  const melee = PRIMARY_MELEE_ATTACK_CONFIGS[abilityId as keyof typeof PRIMARY_MELEE_ATTACK_CONFIGS]
  if (melee) return melee.displayName
  return abilityId.replace(/_/g, " ")
}

/**
 * Builds a single kill-feed line from a `PlayerDeathPayload`.
 *
 * @param death - Server death event.
 * @returns One line of plain text.
 */
export function formatKillFeedLine(death: PlayerDeathPayload): string {
  const victim = death.victimUsername?.trim() || death.playerId
  const ability = killFeedAbilityLabel(death.killerAbilityId)

  if (death.killerPlayerId != null && death.killerPlayerId === death.playerId) {
    return `${victim} — self (${ability})`
  }
  if (death.killerPlayerId == null) {
    return `${victim} died (${ability})`
  }
  const killer = death.killerUsername?.trim() || death.killerPlayerId
  return `${killer} eliminated ${victim} (${ability})`
}
