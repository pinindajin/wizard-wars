/**
 * economySystem – awards gold to players for kills recorded by healthSystem
 * this tick.
 *
 * Kill credit is determined by the `killerUserId` field on each DeathEvent.
 * The killer receives KILL_REWARD gold and their kill counter is incremented.
 * The victim's death counter is also incremented here for the scoreboard.
 */
import type { SimCtx } from "../simulation"
import { Gold } from "../components"
import { KILL_REWARD } from "../../../shared/balance-config"

/**
 * Runs the economy system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function economySystem(ctx: SimCtx): void {
  const { deathEvents, playerEntityMap, killStats, goldUpdates } = ctx

  for (const evt of deathEvents) {
    // Increment victim death count
    const victimStats = killStats.get(evt.userId)
    if (victimStats) {
      victimStats.deaths++
    }

    if (!evt.killerUserId) continue
    if (evt.killerUserId === evt.userId) continue // self-kill

    // Award kill gold
    const killerEid = playerEntityMap.get(evt.killerUserId)
    if (killerEid !== undefined) {
      Gold.amount[killerEid] += KILL_REWARD

      const killerStats = killStats.get(evt.killerUserId)
      if (killerStats) {
        killerStats.kills++
        killerStats.goldEarned += KILL_REWARD
      }

      goldUpdates.push({
        userId: evt.killerUserId,
        gold: Gold.amount[killerEid],
      })
    }
  }
}
