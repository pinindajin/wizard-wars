/**
 * Project-owned native Arena layout data.
 *
 * The arena visual is image-backed at native map resolution. Keep this file in
 * sync with `Arena.scene`, `public/assets/tilemaps/arena.json`, and the
 * generated collider files when the arena changes.
 */
export const ARENA_LAYOUT_WIDTH = 1402
export const ARENA_LAYOUT_HEIGHT = 1122
export const ARENA_LAYOUT_COLS = 22
export const ARENA_LAYOUT_ROWS = 18
export const ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID = 17
export const ARENA_LAYOUT_SPAWN_POINTS = [
  {
    "x": 710,
    "y": 562
  },
  {
    "x": 585,
    "y": 560
  },
  {
    "x": 835,
    "y": 560
  },
  {
    "x": 710,
    "y": 410
  },
  {
    "x": 710,
    "y": 710
  },
  {
    "x": 510,
    "y": 505
  },
  {
    "x": 910,
    "y": 505
  },
  {
    "x": 512,
    "y": 625
  },
  {
    "x": 908,
    "y": 625
  },
  {
    "x": 186,
    "y": 856
  },
  {
    "x": 1216,
    "y": 856
  },
  {
    "x": 710,
    "y": 930
  }
] as const
