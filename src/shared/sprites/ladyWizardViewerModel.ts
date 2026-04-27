import {
  LADY_WIZARD_ATLAS_CLIP_IDS,
  LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET,
  type LadyWizardAtlasClipId,
  LADY_WIZARD_CLIP_FRAMES,
  LADY_WIZARD_DIRECTIONS,
  ladyWizardStripPublicPath,
} from "./ladyWizard"

/** Shape of committed `sheets/atlas.json`. */
export type LadyWizardAtlasJson = {
  frameSize: number
  clips: Record<string, Record<string, number>>
}

export type LadyWizardViewerCell = {
  atlasClipId: LadyWizardAtlasClipId
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
 * Builds a stable gallery matrix: known atlas clip order × eight directions.
 * Missing atlas entries are explicit placeholders (`missing: true`).
 *
 * @param atlas - Parsed `atlas.json` body.
 * @returns Flat list of cells in row-major order (clip major, direction minor).
 */
export function buildLadyWizardViewerCells(atlas: LadyWizardAtlasJson): LadyWizardViewerCell[] {
  const out: LadyWizardViewerCell[] = []

  for (const atlasClipId of LADY_WIZARD_ATLAS_CLIP_IDS) {
    const clipBlock = atlas.clips[atlasClipId]
    const megasheetClip = LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET[atlasClipId]
    const expectedFrames = LADY_WIZARD_CLIP_FRAMES[megasheetClip]

    for (const direction of LADY_WIZARD_DIRECTIONS) {
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
        stripUrl: ladyWizardStripPublicPath(atlasClipId, direction),
        missing,
      })
    }
  }

  return out
}
