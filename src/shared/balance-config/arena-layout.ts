/**
 * Project-owned Arena layout data.
 *
 * The current map was seeded from a one-time external import, but runtime
 * gameplay now reads this committed project data rather than any external map
 * editor export. Keep this file in sync with `Arena.scene` and
 * `public/assets/tilemaps/arena.json` when the arena changes.
 */
export const ARENA_LAYOUT_COLS = 66
export const ARENA_LAYOUT_ROWS = 53
export const ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID = 17
export const ARENA_LAYOUT_SPAWN_POINTS = [
  {
    "x": 3168,
    "y": 1696
  },
  {
    "x": 3040,
    "y": 2272
  },
  {
    "x": 2656,
    "y": 2656
  },
  {
    "x": 2080,
    "y": 2784
  },
  {
    "x": 1504,
    "y": 2656
  },
  {
    "x": 1184,
    "y": 2208
  },
  {
    "x": 1056,
    "y": 1888
  },
  {
    "x": 1184,
    "y": 1184
  },
  {
    "x": 1568,
    "y": 736
  },
  {
    "x": 2080,
    "y": 608
  },
  {
    "x": 2656,
    "y": 736
  },
  {
    "x": 3104,
    "y": 1056
  }
] as const
