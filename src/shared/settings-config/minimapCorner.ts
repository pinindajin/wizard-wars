/** Corners where the in-game minimap can be anchored while compact. */
export const MINIMAP_CORNERS = [
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
] as const

export type MinimapCorner = (typeof MINIMAP_CORNERS)[number]

/** Default minimap placement for new users and stale settings. */
export const DEFAULT_MINIMAP_CORNER: MinimapCorner = "top_left"

/** Returns true when a value is a supported minimap corner. */
export function isMinimapCorner(value: unknown): value is MinimapCorner {
  return (
    typeof value === "string" &&
    (MINIMAP_CORNERS as readonly string[]).includes(value)
  )
}

/** Normalizes persisted or user-provided values to a supported minimap corner. */
export function parseMinimapCorner(value: unknown): MinimapCorner {
  return isMinimapCorner(value) ? value : DEFAULT_MINIMAP_CORNER
}
