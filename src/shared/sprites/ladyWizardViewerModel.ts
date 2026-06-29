import {
  HERO_SPRITE_DIRECTIONS,
  heroSpriteConfigFor,
  heroStripPublicPath,
} from "./heroSprites"

/** Shape of committed `sheets/atlas.json`. */
export type LadyWizardAtlasJson = {
  frameSize: number
  clips: Record<string, Record<string, number>>
}

export type LadyWizardViewerCell = {
  atlasClipId: string
  direction: string
  /** Frame count from atlas when present; 0 when missing. */
  frameCount: number
  /** Expected slot width from megasheet layout. */
  expectedFrames: number
  stripUrl: string
  /** True when atlas omits the direction or reports 0 frames. */
  missing: boolean
}

/**
 * Builds a stable hero gallery matrix: configured atlas clip order × eight directions.
 * Missing atlas entries are explicit placeholders (`missing: true`).
 *
 * @param heroId - Selected hero id.
 * @param atlas - Parsed `atlas.json` body.
 * @returns Flat list of cells in row-major order (clip major, direction minor).
 */
export function buildHeroSpriteViewerCells(
  heroId: string,
  atlas: LadyWizardAtlasJson,
): LadyWizardViewerCell[] {
  const out: LadyWizardViewerCell[] = []
  const spriteConfig = heroSpriteConfigFor(heroId)

  for (const actionClipId of spriteConfig.clipOrder) {
    const clip = spriteConfig.clips[actionClipId]
    const atlasClipId = clip.atlasClipId
    const clipBlock = atlas.clips[atlasClipId]
    const expectedFrames = clip.frameCount

    for (const direction of HERO_SPRITE_DIRECTIONS) {
      const rawCount =
        clipBlock && Object.prototype.hasOwnProperty.call(clipBlock, direction)
          ? (clipBlock[direction] ?? 0)
          : undefined
      const frameCount = rawCount === undefined ? 0 : rawCount
      const missing = rawCount === undefined || frameCount === 0

      out.push({
        atlasClipId,
        direction,
        frameCount,
        expectedFrames,
        stripUrl: heroStripPublicPath(heroId, atlasClipId, direction),
        missing,
      })
    }
  }

  return out
}

/**
 * Builds the legacy Yen/lady-wizard viewer matrix.
 *
 * @param atlas - Parsed `atlas.json` body.
 * @returns Flat list of cells in row-major order.
 */
export function buildLadyWizardViewerCells(atlas: LadyWizardAtlasJson): LadyWizardViewerCell[] {
  return buildHeroSpriteViewerCells("yen", atlas)
}
