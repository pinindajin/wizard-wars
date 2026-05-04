import type { MinimapCorner } from "@/shared/settings-config"

export type MinimapMode = "compact" | "expanded"

export type MinimapViewport = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const COMPACT_WIDTH = 208
const COMPACT_MARGIN = 18
const EXPANDED_WIDTH_RATIO = 0.58
const EXPANDED_HEIGHT_RATIO = 0.7

/**
 * Computes an arena-aspect minimap camera viewport in game canvas pixels.
 */
export function computeMinimapViewport(params: {
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly arenaWidth: number
  readonly arenaHeight: number
  readonly corner: MinimapCorner
  readonly mode: MinimapMode
}): MinimapViewport {
  const arenaAspect = params.arenaWidth / params.arenaHeight
  const compactHeight = Math.round(COMPACT_WIDTH / arenaAspect)
  const maxExpandedWidth = Math.round(params.canvasWidth * EXPANDED_WIDTH_RATIO)
  const maxExpandedHeight = Math.round(params.canvasHeight * EXPANDED_HEIGHT_RATIO)

  const width =
    params.mode === "expanded"
      ? Math.min(maxExpandedWidth, Math.round(maxExpandedHeight * arenaAspect))
      : COMPACT_WIDTH
  const height =
    params.mode === "expanded"
      ? Math.min(maxExpandedHeight, Math.round(width / arenaAspect))
      : compactHeight

  if (params.mode === "expanded") {
    return {
      x: Math.round((params.canvasWidth - width) / 2),
      y: Math.round((params.canvasHeight - height) / 2),
      width,
      height,
    }
  }

  const left = params.corner === "top_left" || params.corner === "bottom_left"
  const top = params.corner === "top_left" || params.corner === "top_right"

  return {
    x: left ? COMPACT_MARGIN : params.canvasWidth - width - COMPACT_MARGIN,
    y: top ? COMPACT_MARGIN : params.canvasHeight - height - COMPACT_MARGIN,
    width,
    height,
  }
}
