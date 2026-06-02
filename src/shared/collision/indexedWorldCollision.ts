import type { PlayerTerrainState } from "../types"
import {
  ARENA_CLIFF_COLLIDER_SET,
  ARENA_LAVA_COLLIDER_SET,
  ARENA_WORLD_COLLIDER_SET,
  type IndexedColliderSet,
} from "./arenaSpatialIndexes"
import { queryAabbIds, queryPointIds, type Aabb } from "./spatialIndex"
import {
  canOccupyWorldPosition,
  moveWithinWorld,
  resolveAgainstWorld,
  type ArenaBounds,
  type JumpLandingGraceContext,
  type WorldCandidateGate,
  type WorldCollisionFootprint,
  type WorldMoveResult,
} from "./worldCollision"

export function canOccupyWorldPositionIndexed(
  x: number,
  y: number,
  footprint: WorldCollisionFootprint,
  bounds: ArenaBounds,
  colliderSet: IndexedColliderSet = ARENA_WORLD_COLLIDER_SET,
): boolean {
  const colliders = collidersForFootprint(x, y, footprint, colliderSet)
  return canOccupyWorldPosition(x, y, footprint, bounds, colliders)
}

export function moveWithinWorldIndexed(
  x: number,
  y: number,
  stepX: number,
  stepY: number,
  footprint: WorldCollisionFootprint,
  bounds: ArenaBounds,
  colliderSet: IndexedColliderSet = ARENA_WORLD_COLLIDER_SET,
  canOccupyCandidate?: WorldCandidateGate,
): WorldMoveResult {
  const startAabb = footprintAabb(x, y, footprint)
  const endAabb = footprintAabb(x + stepX, y + stepY, footprint)
  const queryAabb = unionAabb(startAabb, endAabb)
  const colliders = collidersForAabb(queryAabb, colliderSet)
  return moveWithinWorld(
    x,
    y,
    stepX,
    stepY,
    footprint,
    bounds,
    colliders,
    canOccupyCandidate,
  )
}

export function resolveJumpLandingWithGraceIndexed(
  x: number,
  y: number,
  footprint: WorldCollisionFootprint,
  bounds: ArenaBounds,
  context: JumpLandingGraceContext,
  colliderSet: IndexedColliderSet = ARENA_WORLD_COLLIDER_SET,
): { x: number; y: number } | null {
  if (canOccupyWorldPositionIndexed(x, y, footprint, bounds, colliderSet)) {
    return { x, y }
  }

  const gracePx = Math.max(0, context.gracePx)
  if (gracePx === 0) return null

  const candidates: { dx: number; dy: number }[] = []
  const movementLength = Math.hypot(context.movementX, context.movementY)
  if (movementLength > 0) {
    candidates.push({
      dx: context.movementX / movementLength,
      dy: context.movementY / movementLength,
    })
  }
  if (context.movementX !== 0) candidates.push({ dx: Math.sign(context.movementX), dy: 0 })
  if (context.movementY !== 0) candidates.push({ dx: 0, dy: Math.sign(context.movementY) })

  const steps = Math.ceil(gracePx)
  for (let i = 1; i <= steps; i++) {
    const distance = Math.min(i, gracePx)
    for (const candidate of candidates) {
      const nx = x + candidate.dx * distance
      const ny = y + candidate.dy * distance
      if (canOccupyWorldPositionIndexed(nx, ny, footprint, bounds, colliderSet)) {
        return { x: nx, y: ny }
      }
    }
  }

  const resolved = resolveAgainstWorld(x, y, footprint, bounds, colliderSet.rects)
  const moved = Math.hypot(resolved.x - x, resolved.y - y)
  if (
    moved <= gracePx &&
    canOccupyWorldPositionIndexed(resolved.x, resolved.y, footprint, bounds, colliderSet)
  ) {
    return resolved
  }

  return null
}

export function terrainStateAtPositionIndexed(x: number, y: number): PlayerTerrainState {
  if (queryPointIds(ARENA_LAVA_COLLIDER_SET.index, x, y, ARENA_LAVA_COLLIDER_SET.scratch).length > 0) {
    return "lava"
  }
  if (queryPointIds(ARENA_CLIFF_COLLIDER_SET.index, x, y, ARENA_CLIFF_COLLIDER_SET.scratch).length > 0) {
    return "cliff"
  }
  return "land"
}

function collidersForFootprint(
  x: number,
  y: number,
  footprint: WorldCollisionFootprint,
  colliderSet: IndexedColliderSet,
): readonly IndexedColliderSet["rects"][number][] {
  return collidersForAabb(footprintAabb(x, y, footprint), colliderSet)
}

function collidersForAabb(
  aabb: Aabb,
  colliderSet: IndexedColliderSet,
): readonly IndexedColliderSet["rects"][number][] {
  const ids = queryAabbIds(colliderSet.index, aabb, colliderSet.scratch)
  return ids.map((id) => colliderSet.rects[id]!)
}

function footprintAabb(
  x: number,
  y: number,
  footprint: WorldCollisionFootprint,
): Aabb {
  const centerY = y + footprint.offsetY
  return {
    x: x - footprint.radiusX,
    y: centerY - footprint.radiusY,
    width: footprint.radiusX * 2,
    height: footprint.radiusY * 2,
  }
}

function unionAabb(a: Aabb, b: Aabb): Aabb {
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}
