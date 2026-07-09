import { ARENA_CLIFF_COLLIDERS } from "../balance-config/arena"
import type { PlayerTerrainState } from "../types"

export function effectiveTerrainStateForCurrentArena(
  terrainState: PlayerTerrainState,
): PlayerTerrainState {
  if (terrainState === "cliff" && ARENA_CLIFF_COLLIDERS.length === 0) return "land"
  return terrainState
}
