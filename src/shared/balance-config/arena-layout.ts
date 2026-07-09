/**
 * Project-owned native Arena layout data.
 *
 * The arena visual is image-backed at native map resolution. Keep this file in
 * sync with `Arena.scene`, `public/assets/tilemaps/arena.json`, and the
 * generated collider files when the arena changes.
 */
export const ARENA_LAYOUT_WIDTH = 2112
export const ARENA_LAYOUT_HEIGHT = 1696
export const ARENA_LAYOUT_COLS = 33
export const ARENA_LAYOUT_ROWS = 27
export const ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID = 17
export const ARENA_LAYOUT_SPAWN_POINTS = [
  {
    "x": 1056,
    "y": 848
  },
  {
    "x": 904,
    "y": 824
  },
  {
    "x": 1208,
    "y": 840
  },
  {
    "x": 1056,
    "y": 696
  },
  {
    "x": 1056,
    "y": 1000
  },
  {
    "x": 872,
    "y": 728
  },
  {
    "x": 1240,
    "y": 728
  },
  {
    "x": 872,
    "y": 976
  },
  {
    "x": 1240,
    "y": 976
  },
  {
    "x": 464,
    "y": 264
  },
  {
    "x": 1568,
    "y": 256
  },
  {
    "x": 328,
    "y": 808
  }
] as const
