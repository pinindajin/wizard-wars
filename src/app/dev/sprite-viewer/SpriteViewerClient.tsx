"use client"

import type { ReactNode } from "react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"

import {
  computeAlphaOutlineSegments,
  strokeAlphaOutlineSegments,
  type AlphaOutlineSegment,
} from "@/lib/sprite-outline"
import {
  type LadyWizardAtlasClipId,
  LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET,
  LADY_WIZARD_CLIP_FPS,
  LADY_WIZARD_FRAME_SIZE_PX,
  LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y,
  ladyWizardAtlasPublicPath,
} from "@/shared/sprites/ladyWizard"
import {
  buildLadyWizardViewerCells,
  type LadyWizardAtlasJson,
  type LadyWizardViewerCell,
} from "@/shared/sprites/ladyWizardViewerModel"
import {
  SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX,
  SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX,
  spriteViewerCharacterHitbox,
  spriteViewerCenterpoint,
  spriteViewerCenterpointTooltip,
  spriteViewerMovementOvalRadii,
} from "@/shared/sprites/spriteViewerOverlays"

const DETAIL_SCALE = 2
const DETAIL_PAD = 16
const FRAME = LADY_WIZARD_FRAME_SIZE_PX

/**
 * One legend line with a click-to-expand details panel (avoids hover/stacking/CSS issues).
 *
 * @param props.label - Visible one-line summary next to the control.
 * @param props.testId - Optional `data-testid` for the toggle button (E2E).
 * @param props.children - Expanded body (paragraphs).
 * @returns Row element.
 */
function LegendTipRow(props: { label: ReactNode; testId?: string; children: ReactNode }) {
  const { label, testId, children } = props
  const [open, setOpen] = useState(false)
  const panelId = useId().replace(/:/g, "")
  return (
    <div className="overflow-hidden rounded-md border border-zinc-700/80 bg-zinc-900/50">
      <div className="flex items-start gap-2 px-2 py-1.5">
        <div className="min-w-0 flex-1 leading-snug">{label}</div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-violet-500/50 bg-zinc-800/95 text-xs font-bold text-violet-300 shadow-sm hover:border-violet-400 hover:bg-zinc-700 hover:text-violet-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-400"
          aria-label={open ? "Hide technical details" : "Show technical details"}
          onClick={() => setOpen((v) => !v)}
          {...(testId ? { "data-testid": testId } : {})}
        >
          <span aria-hidden>{open ? "×" : "ⓘ"}</span>
        </button>
      </div>
      {open ? (
        <div
          id={panelId}
          role="region"
          className="max-h-56 overflow-y-auto border-t border-zinc-700/80 bg-zinc-950/95 px-2 py-2 text-left text-[10px] leading-relaxed text-zinc-200"
        >
          <div className="space-y-2">{children}</div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Builds a stable cache key for outline data derived from a strip URL and frame index.
 *
 * @param stripUrl - Root-relative PNG URL.
 * @param frameIndex - Zero-based frame within the horizontal strip.
 * @returns Cache key string.
 */
function outlineCacheKey(stripUrl: string, frameIndex: number): string {
  return `${stripUrl}#${frameIndex}`
}

/**
 * Extracts RGBA samples for one frame from a loaded horizontal strip image.
 *
 * @param img - Decoded strip image (`naturalWidth` is strip width).
 * @param frameIndex - Frame column index.
 * @returns ImageData for the `FRAME×FRAME` cel, or null if dimensions are invalid.
 */
function copyFrameImageData(img: HTMLImageElement, frameIndex: number): ImageData | null {
  const sx = frameIndex * FRAME
  if (sx + FRAME > img.naturalWidth || img.naturalHeight < FRAME) return null
  const c = document.createElement("canvas")
  c.width = FRAME
  c.height = FRAME
  const cctx = c.getContext("2d")
  if (!cctx) return null
  cctx.imageSmoothingEnabled = false
  cctx.drawImage(img, sx, 0, FRAME, FRAME, 0, 0, FRAME, FRAME)
  return cctx.getImageData(0, 0, FRAME, FRAME)
}

/**
 * Client UI for the lady-wizard sprite viewer: gallery, detail canvas, overlays, playback.
 *
 * @returns React tree for `/dev/sprite-viewer`.
 */
export function SpriteViewerClient() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const outlineCacheRef = useRef<Map<string, AlphaOutlineSegment[]>>(new Map())
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(0)
  const stripImageRef = useRef<HTMLImageElement | null>(null)

  const [atlas, setAtlas] = useState<LadyWizardAtlasJson | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<LadyWizardViewerCell | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [stripLoaded, setStripLoaded] = useState(false)
  const [stripBroken, setStripBroken] = useState(false)
  const [showCollision, setShowCollision] = useState(true)
  const [showEdge, setShowEdge] = useState(true)

  const cells = useMemo(() => (atlas ? buildLadyWizardViewerCells(atlas) : []), [atlas])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(ladyWizardAtlasPublicPath())
        if (!res.ok) throw new Error(`atlas ${res.status}`)
        const json = (await res.json()) as LadyWizardAtlasJson
        if (cancelled) return
        setAtlas(json)
        const built = buildLadyWizardViewerCells(json)
        const first = built.find((c) => !c.missing) ?? built[0] ?? null
        setSelected(first)
        setFrameIndex(0)
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "atlas load failed")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    stripImageRef.current = null
    queueMicrotask(() => {
      setStripLoaded(false)
      setStripBroken(false)
    })
    if (!selected || selected.missing) return

    const img = new Image()
    img.decoding = "async"
    img.onload = () => {
      stripImageRef.current = img
      setStripLoaded(true)
      setStripBroken(false)
    }
    img.onerror = () => {
      stripImageRef.current = null
      setStripLoaded(false)
      setStripBroken(true)
    }
    img.src = selected.stripUrl
  }, [selected])

  const megasheetClip = selected
    ? LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET[selected.atlasClipId as LadyWizardAtlasClipId]
    : undefined
  const fps = megasheetClip ? LADY_WIZARD_CLIP_FPS[megasheetClip] : 8
  const maxFrame = selected && !selected.missing ? Math.max(0, selected.frameCount - 1) : 0
  const displayFrame = Math.min(frameIndex, maxFrame)

  /**
   * Returns cached outline segments for a frame, computing once per cache key.
   *
   * @param img - Loaded strip image.
   * @param stripUrl - Strip URL used for cache keying.
   * @param frameIndex - Frame index within the strip.
   * @returns Outline segments in frame pixel space.
   */
  const getOrComputeOutline = useCallback(
    (img: HTMLImageElement, stripUrl: string, frameIndex: number): AlphaOutlineSegment[] => {
      const key = outlineCacheKey(stripUrl, frameIndex)
      const hit = outlineCacheRef.current.get(key)
      if (hit) return hit
      const idata = copyFrameImageData(img, frameIndex)
      if (!idata) return []
      const segs = computeAlphaOutlineSegments(idata.data, FRAME, FRAME)
      outlineCacheRef.current.set(key, segs)
      return segs
    },
    [],
  )

  const drawDetail = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const cw = FRAME * DETAIL_SCALE + DETAIL_PAD * 2
    const ch = FRAME * DETAIL_SCALE + DETAIL_PAD * 2
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }

    ctx.fillStyle = "#0c0c12"
    ctx.fillRect(0, 0, cw, ch)

    const cx = DETAIL_PAD + (FRAME * DETAIL_SCALE) / 2
    const cy = DETAIL_PAD + FRAME * DETAIL_SCALE

    if (!selected || selected.missing || stripBroken || !stripLoaded) {
      ctx.fillStyle = "#64748b"
      ctx.font = "14px monospace"
      ctx.textAlign = "center"
      const msg = !selected
        ? "—"
        : selected.missing
          ? "Missing strip (atlas)"
          : stripBroken
            ? "Image failed to load"
            : "Loading…"
      ctx.fillText(msg, cw / 2, ch / 2)
      return
    }

    const img = stripImageRef.current
    if (!img) return

    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.translate(cx, cy)
    ctx.scale(DETAIL_SCALE, DETAIL_SCALE)
    ctx.drawImage(img, displayFrame * FRAME, 0, FRAME, FRAME, -FRAME / 2, -FRAME, FRAME, FRAME)

    const centerpoint = spriteViewerCenterpoint()
    if (showCollision) {
      const movementOval = spriteViewerMovementOvalRadii()
      const combatHitbox = spriteViewerCharacterHitbox()
      ctx.strokeStyle = "rgba(34, 197, 94, 0.85)"
      ctx.lineWidth = 1 / DETAIL_SCALE
      ctx.beginPath()
      ctx.ellipse(
        centerpoint.x,
        centerpoint.y + movementOval.offsetY,
        movementOval.radiusX,
        movementOval.radiusY,
        0,
        0,
        Math.PI * 2,
      )
      ctx.stroke()
      ctx.strokeStyle = "rgba(216, 180, 254, 0.95)"
      ctx.strokeRect(combatHitbox.x, combatHitbox.y, combatHitbox.width, combatHitbox.height)
      ctx.strokeStyle = "rgba(244, 63, 94, 0.95)"
      ctx.fillStyle = "rgba(255, 255, 255, 0.95)"
      ctx.beginPath()
      ctx.moveTo(centerpoint.x - SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX, centerpoint.y)
      ctx.lineTo(centerpoint.x + SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX, centerpoint.y)
      ctx.moveTo(centerpoint.x, centerpoint.y - SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX)
      ctx.lineTo(centerpoint.x, centerpoint.y + SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(
        centerpoint.x,
        centerpoint.y,
        SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX,
        0,
        Math.PI * 2,
      )
      ctx.fill()
    }

    if (showEdge) {
      const segs = getOrComputeOutline(img, selected.stripUrl, displayFrame)
      ctx.strokeStyle = "rgba(56, 189, 248, 0.9)"
      ctx.lineWidth = 1 / DETAIL_SCALE
      strokeAlphaOutlineSegments(ctx, segs, -FRAME / 2, -FRAME)
    }

    ctx.restore()
  }, [selected, stripLoaded, stripBroken, displayFrame, showCollision, showEdge, getOrComputeOutline])

  useEffect(() => {
    drawDetail()
  }, [drawDetail])

  useEffect(() => {
    if (!playing || !selected || selected.missing || fps <= 0) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const step = (t: number) => {
      if (!lastTickRef.current) lastTickRef.current = t
      const dt = t - lastTickRef.current
      const interval = 1000 / fps
      if (dt >= interval) {
        lastTickRef.current = t
        setFrameIndex((i) => {
          const capped = Math.min(i, maxFrame)
          const next = capped + 1
          return next > maxFrame ? 0 : next
        })
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTickRef.current = 0
    }
  }, [playing, selected, fps, maxFrame])

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 md:flex-row md:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header>
          <h1 className="font-mono text-lg tracking-tight text-zinc-100">Lady-wizard sprite viewer</h1>
          <p className="max-w-xl text-sm text-zinc-400">
            Shipped strips from <code className="text-violet-300">/assets/.../sheets/atlas.json</code>. Collision
            overlay shows the movement oval and character hitbox centered on the sim anchor (texture bottom minus{" "}
            <code className="text-violet-300">{LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y}px</code>).
          </p>
        </header>

        {loadError ? (
          <p className="text-sm text-red-400">Failed to load atlas: {loadError}</p>
        ) : (
          <div
            className="grid max-h-[min(70vh,720px)] gap-1 overflow-auto rounded border border-zinc-800 bg-zinc-900/80 p-2 [image-rendering:pixelated]"
            data-testid="sprite-viewer-gallery"
            style={{ gridTemplateColumns: "repeat(8, minmax(72px, 1fr))" }}
          >
            {cells.map((cell) => {
              const active =
                selected &&
                selected.atlasClipId === cell.atlasClipId &&
                selected.direction === cell.direction
              return (
                <button
                  key={`${cell.atlasClipId}-${cell.direction}`}
                  type="button"
                  disabled={cell.missing}
                  onClick={() => {
                    setSelected(cell)
                    setFrameIndex(0)
                    setPlaying(false)
                  }}
                  className={[
                    "flex flex-col items-center justify-center rounded border px-1 py-2 font-mono text-[10px] leading-tight",
                    cell.missing
                      ? "cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600"
                      : "border-zinc-700 bg-zinc-800/90 text-zinc-200 hover:border-violet-500/60",
                    active ? "ring-2 ring-violet-500" : "",
                  ].join(" ")}
                >
                  <span className="truncate text-zinc-400">{cell.atlasClipId}</span>
                  <span>{cell.direction}</span>
                  {cell.missing ? <span className="mt-1 text-amber-500">—</span> : <span className="mt-1">{cell.frameCount}f</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 overflow-visible md:w-[380px]">
        <div className="rounded border border-zinc-800 bg-zinc-900/90 p-4">
          <h2 className="mb-2 font-mono text-sm text-zinc-300">Detail</h2>
          <canvas
            ref={canvasRef}
            className="mx-auto block rounded border border-zinc-800 bg-black"
            style={{ imageRendering: "pixelated" }}
            data-testid="sprite-viewer-detail-canvas"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showCollision}
                onChange={(e) => setShowCollision(e.target.checked)}
                data-testid="sprite-viewer-collision-toggle"
              />
              Collision
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showEdge}
                onChange={(e) => setShowEdge(e.target.checked)}
                data-testid="sprite-viewer-edge-toggle"
              />
              Alpha edge
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded bg-violet-700 px-3 py-1 font-mono text-xs text-white hover:bg-violet-600"
              disabled={!selected || selected.missing || stripBroken}
              onClick={() => setPlaying((p) => !p)}
              data-testid="sprite-viewer-play-toggle"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <label className="flex items-center gap-2 font-mono text-xs text-zinc-400">
              Frame
              <input
                type="range"
                min={0}
                max={maxFrame}
                value={displayFrame}
                disabled={!selected || selected.missing || stripBroken || maxFrame <= 0}
                onChange={(e) => {
                  setPlaying(false)
                  setFrameIndex(Number(e.target.value))
                }}
                data-testid="sprite-viewer-frame-scrub"
              />
              <span className="text-zinc-300">
                {displayFrame + 1}/{maxFrame + 1}
              </span>
            </label>
          </div>
          {selected ? (
            <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">{selected.stripUrl}</p>
          ) : null}
        </div>

        <div
          className="relative overflow-visible rounded border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-[11px] leading-relaxed text-zinc-400"
          data-testid="sprite-viewer-legend"
        >
          <div className="mb-1 text-zinc-300">Legend</div>
          <p
            className="mb-2 text-[10px] leading-snug text-zinc-500"
            data-testid="sprite-viewer-legend-hint"
          >
            Click the <span className="text-violet-400">ⓘ</span> on each line to expand or collapse the full technical
            notes (no hover required).
          </p>
          <div className="flex flex-col gap-2.5">
            <LegendTipRow
              testId="sprite-viewer-legend-info-centerpoint"
              label={
                <span title={spriteViewerCenterpointTooltip()}>
                  <span className="text-rose-400">Red/white</span>: centerpoint / sim anchor.
                </span>
              }
            >
              <p>
                <strong className="text-zinc-100">What it is.</strong> The centerpoint is the authoritative{" "}
                <code className="text-violet-300">Position.x/y</code> used by movement, collision, combat targeting,
                camera follow, and render interpolation. The detail canvas draws it at{" "}
                <code className="text-violet-300">
                  ({spriteViewerCenterpoint().x}, {spriteViewerCenterpoint().y})
                </code>{" "}
                relative to the cel because the sprite art is bottom-anchored and shifted by{" "}
                <code className="text-violet-300">LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y</code>.
              </p>
              <p>
                <strong className="text-zinc-100">Relationship to overlays.</strong> The movement oval and character
                hitbox are drawn from balance constants around this point. Spawn/sync state provides the point; the
                overlays define separate world-collision and combat shapes around it.
              </p>
            </LegendTipRow>
            <LegendTipRow
              testId="sprite-viewer-legend-info-collision"
              label={
                <span>
                  <span className="text-emerald-400">Green</span>: movement oval ({spriteViewerMovementOvalRadii().radiusX}×
                  {spriteViewerMovementOvalRadii().radiusY} radii, +{spriteViewerMovementOvalRadii().offsetY}px y).
                </span>
              }
            >
              <p>
                <strong className="text-zinc-100">What it is.</strong> World collision uses an axis-aligned oval in
                world space: center at authoritative <code className="text-violet-300">(x, y)</code>, horizontal radius{" "}
                <code className="text-violet-300">{spriteViewerMovementOvalRadii().radiusX}px</code>, vertical radius{" "}
                <code className="text-violet-300">{spriteViewerMovementOvalRadii().radiusY}px</code>, shifted{" "}
                <code className="text-violet-300">{spriteViewerMovementOvalRadii().offsetY}px</code> below the sim
                anchor.
              </p>
              <p>
                <strong className="text-zinc-100">Systems that use it.</strong> Server:{" "}
                <code className="text-violet-300">movementSystem</code> and{" "}
                <code className="text-violet-300">worldCollisionSystem</code>. Client:{" "}
                <code className="text-violet-300">ReconciliationSystem</code> and{" "}
                <code className="text-violet-300">PlayerRenderSystem</code> prediction replay.
              </p>
              <p>
                <strong className="text-zinc-100">If you change it.</strong> This changes wall, bounds, and non-walkable
                terrain feel only. Combat damage uses the purple character hitbox.
              </p>
            </LegendTipRow>
            <LegendTipRow
              testId="sprite-viewer-legend-info-hitbox"
              label={
                <span>
                  <span className="text-fuchsia-300">Purple</span>: character hitbox ({spriteViewerCharacterHitbox().width}×
                  {spriteViewerCharacterHitbox().height}).
                </span>
              }
            >
              <p>
                <strong className="text-zinc-100">What it is.</strong> The combat body rectangle anchored at the sim
                point: 15 px left, 15 px right, 40 px up, and 15 px down.
              </p>
              <p>
                <strong className="text-zinc-100">Systems that use it.</strong>{" "}
                <code className="text-violet-300">projectileCollisionSystem</code>,{" "}
                <code className="text-violet-300">lightningBoltSystem</code>, and{" "}
                <code className="text-violet-300">primaryMeleeAttackSystem</code>.
              </p>
              <p>
                <strong className="text-zinc-100">If you change it.</strong> Fireball, lightning, and melee hit fairness
                shifts. Movement against terrain stays controlled by the green oval.
              </p>
            </LegendTipRow>
            <LegendTipRow
              testId="sprite-viewer-legend-info-edge"
              label={
                <span>
                  <span className="text-sky-400">Cyan</span>: opaque alpha outline (cached per frame).
                </span>
              }
            >
              <p>
                <strong className="text-zinc-100">What it is.</strong> A 1px outline along the boundary between opaque
                and transparent pixels in the current cel (alpha threshold in{" "}
                <code className="text-violet-300">computeAlphaOutlineSegments</code>). Results are{" "}
                <strong className="text-zinc-100">cached</strong> per strip URL + frame index so scrubbing playback
                stays cheap.
              </p>
              <p>
                <strong className="text-zinc-100">Systems that use it.</strong>{" "}
                <strong className="text-zinc-100">None in gameplay.</strong> Phaser renders textures and animation
                frames, but no server or client sim path consumes this outline for hits, line-of-sight, or pathfinding.
                It is purely a <strong className="text-zinc-100">dev/QA art signal</strong>: trims, padding, and
                semi-transparent fringe relative to the fixed {FRAME}px cel.
              </p>
              <p>
                <strong className="text-zinc-100">If you change it.</strong> Adjusting threshold, caching, or stroke
                color in the viewer affects diagnostics only. Changing the actual PNGs or atlas layout is what changes
                what players see in-game through Phaser—plan asset rebuilds (<code className="text-violet-300">build:lady-wizard-sheets</code> /{" "}
                <code className="text-violet-300">build:lady-wizard-megasheet</code>) when art changes.
              </p>
            </LegendTipRow>
          </div>
        </div>
      </aside>
    </div>
  )
}
