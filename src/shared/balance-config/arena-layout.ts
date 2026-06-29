/**
 * Project-owned native Arena layout data.
 *
 * The arena visual is image-backed at native map resolution. Keep this file in
 * sync with `Arena.scene`, `public/assets/tilemaps/arena.json`, and the
 * generated collider files when the arena changes.
 */
export const ARENA_LAYOUT_WIDTH = 2804
export const ARENA_LAYOUT_HEIGHT = 2244
export const ARENA_LAYOUT_COLS = 44
export const ARENA_LAYOUT_ROWS = 36
export const ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID = 17
export const ARENA_LAYOUT_SPAWN_POINTS = [
  {
    "x": 1420,
    "y": 1124
  },
  {
    "x": 1170,
    "y": 1120
  },
  {
    "x": 1670,
    "y": 1120
  },
  {
    "x": 1420,
    "y": 820
  },
  {
    "x": 1420,
    "y": 1420
  },
  {
    "x": 1020,
    "y": 1010
  },
  {
    "x": 1820,
    "y": 1010
  },
  {
    "x": 1024,
    "y": 1250
  },
  {
    "x": 1816,
    "y": 1250
  },
  {
    "x": 372,
    "y": 1712
  },
  {
    "x": 2432,
    "y": 1712
  },
  {
    "x": 1400,
    "y": 1860
  }
] as const
