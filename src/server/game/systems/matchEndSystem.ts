/**
 * matchEndSystem – checks all three match-end conditions each tick and writes
 * the matchEnded field on SimCtx if any condition is met.
 *
 * Conditions (checked in priority order):
 *  1. lives_depleted – at least one player has SpectatorTag (lives = 0).
 *  2. host_ended     – ctx.hostEndSignal is true.
 *  3. time_cap       – elapsed match time ≥ MATCH_MAX_DURATION_MS.
 *
 * Once ctx.matchEnded is set, subsequent systems see it and can act accordingly.
 */
import { query, hasComponent } from "bitecs"

import {
  PlayerTag,
  SpectatorTag,
  Lives,
  Health,
  HERO_INDEX_TO_ID,
  Hero,
} from "../components"
import type { SimCtx } from "../simulation"
import { MATCH_MAX_DURATION_MS } from "../../../shared/balance-config"
import type { ScoreboardEntry } from "../../../shared/types"

/**
 * Builds the scoreboard entries from current world state and kill-stats.
 */
function buildScoreboard(ctx: SimCtx): ScoreboardEntry[] {
  const entries: ScoreboardEntry[] = []

  for (const [userId, stats] of ctx.killStats) {
    const eid = ctx.playerEntityMap.get(userId)
    if (eid === undefined) continue

    const heroIndex = eid !== undefined ? Hero.typeIndex[eid] : 0
    const heroId = HERO_INDEX_TO_ID[heroIndex] ?? "red_wizard"
    const username = ctx.playerUsernameMap.get(userId) ?? userId

    entries.push({
      playerId: userId,
      username,
      heroId,
      kills: stats.kills,
      deaths: stats.deaths,
      livesRemaining: eid !== undefined ? Lives.count[eid] : 0,
      goldEarned: stats.goldEarned,
    })
  }

  // Sort: most kills first, then fewest deaths, then alphabetically
  entries.sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills
    if (a.deaths !== b.deaths) return a.deaths - b.deaths
    return a.username.localeCompare(b.username)
  })

  return entries
}

/**
 * Runs the match end system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function matchEndSystem(ctx: SimCtx): void {
  const { world, serverTimeMs, matchStartedAtMs, hostEndSignal } = ctx

  // Already ended this tick (shouldn't happen, but guard)
  if (ctx.matchEnded) return

  // 1. lives_depleted
  const spectatorCount = query(world, [PlayerTag, SpectatorTag]).length
  if (spectatorCount > 0) {
    ctx.matchEnded = {
      reason: "lives_depleted",
      entries: buildScoreboard(ctx),
    }
    return
  }

  // 2. host_ended
  if (hostEndSignal) {
    ctx.matchEnded = {
      reason: "host_ended",
      entries: buildScoreboard(ctx),
    }
    return
  }

  // 3. time_cap
  if (serverTimeMs - matchStartedAtMs >= MATCH_MAX_DURATION_MS) {
    ctx.matchEnded = {
      reason: "time_cap",
      entries: buildScoreboard(ctx),
    }
  }
}
