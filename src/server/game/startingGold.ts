import { STARTING_GOLD } from "../../shared/balance-config/economy"

type StartingGoldEnv = {
  readonly WIZARD_WARS_E2E?: string
  readonly WW_E2E_STARTING_GOLD?: string
}

/**
 * Resolves match starting gold. Production always uses the shared balance
 * value; E2E may override it for shop-heavy playtests.
 */
export function resolveStartingGold(env?: StartingGoldEnv): number {
  const isE2e = env?.WIZARD_WARS_E2E ?? process.env.WIZARD_WARS_E2E
  if (isE2e !== "1") return STARTING_GOLD

  const raw = env?.WW_E2E_STARTING_GOLD ?? process.env.WW_E2E_STARTING_GOLD
  if (raw === undefined) return STARTING_GOLD

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) return STARTING_GOLD

  return parsed
}
