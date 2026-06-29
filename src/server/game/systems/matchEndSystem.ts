/**
 * matchEndSystem – checks all three match-end conditions each tick and writes
 * the matchEnded field on SimCtx if any condition is met.
 *
 * Conditions (checked in priority order):
 *  1. lives_depleted – eliminations leave one or zero active players.
 *  2. host_ended     – ctx.hostEndSignal is true.
 *  3. time_cap       – elapsed match time ≥ MATCH_MAX_DURATION_MS.
 *
 * Once ctx.matchEnded is set, subsequent systems see it and can act accordingly.
 */
import { query } from "bitecs"

import {
  PlayerTag,
  SpectatorTag,
  Lives,
  HERO_INDEX_TO_ID,
  Hero,
} from "../components"
import type { SimCtx } from "../simulation"
import { MATCH_MAX_DURATION_MS } from "../../../shared/balance-config"
import { DEFAULT_HERO_ID } from "../../../shared/balance-config/heroes"
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
    const heroId = HERO_INDEX_TO_ID[heroIndex] ?? DEFAULT_HERO_ID
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
  const playerCount = query(world, [PlayerTag]).length
  const spectatorCount = query(world, [PlayerTag, SpectatorTag]).length
  const activePlayerCount = playerCount - spectatorCount
  if (spectatorCount > 0 && activePlayerCount <= 1) {
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
