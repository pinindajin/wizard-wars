/**
 * Project-owned native Arena layout data.
 *
 * The arena visual is image-backed at native map resolution. Keep this file in
 * sync with `Arena.scene`, `public/assets/tilemaps/arena.json`, and the
 * generated collider files when the arena changes.
 */
export const ARENA_LAYOUT_WIDTH = 4224
export const ARENA_LAYOUT_HEIGHT = 3392
export const ARENA_LAYOUT_COLS = 66
export const ARENA_LAYOUT_ROWS = 53
export const ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID = 17
export const ARENA_LAYOUT_SPAWN_POINTS = [
  {
    "x": 2112,
    "y": 1696
  },
  {
    "x": 1808,
    "y": 1688
  },
  {
    "x": 2416,
    "y": 1696
  },
  {
    "x": 2112,
    "y": 1392
  },
  {
    "x": 2112,
    "y": 1992
  },
  {
    "x": 1744,
    "y": 1448
  },
  {
    "x": 2480,
    "y": 1448
  },
  {
    "x": 1744,
    "y": 1944
  },
  {
    "x": 2480,
    "y": 1944
  },
  {
    "x": 920,
    "y": 520
  },
  {
    "x": 3120,
    "y": 520
  },
  {
    "x": 680,
    "y": 1584
  }
] as const
