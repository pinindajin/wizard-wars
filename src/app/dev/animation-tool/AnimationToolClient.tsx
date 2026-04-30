"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  computeAlphaOutlineSegments,
  strokeAlphaOutlineSegments,
  type AlphaOutlineSegment,
} from "@/lib/sprite-outline"
import {
  ANIMATION_CONFIG,
  ANIMATION_CONFIG_SCHEMA_VERSION,
  frameRateForDuration,
  getAnimationToolActions,
  msToFrameIndex,
  msToTickOffset,
  parseAnimationConfig,
  type AnimationActionConfig,
  type AnimationActionId,
  type AnimationConfig,
  type AnimationToolAction,
} from "@/shared/balance-config/animationConfig"
import { HERO_CONFIGS, VALID_HERO_IDS } from "@/shared/balance-config/heroes"
import {
  LADY_WIZARD_DIRECTIONS,
  LADY_WIZARD_FRAME_SIZE_PX,
  LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y,
  ladyWizardAtlasPublicPath,
  type LadyWizardDirection,
} from "@/shared/sprites/ladyWizard"
import {
  buildLadyWizardViewerCells,
  type LadyWizardAtlasJson,
  type LadyWizardViewerCell,
} from "@/shared/sprites/ladyWizardViewerModel"
import {
  SPRITE_VIEWER_CENTERPOINT_MARKER_ARM_PX,
  SPRITE_VIEWER_CENTERPOINT_MARKER_RADIUS_PX,
  spriteViewerAttackHurtbox,
  spriteViewerCharacterHitbox,
  spriteViewerCenterpoint,
  spriteViewerFrameIsDangerous,
  spriteViewerMovementOvalRadii,
} from "@/shared/sprites/spriteViewerOverlays"

const FRAME = LADY_WIZARD_FRAME_SIZE_PX
const PREVIEW_SCALE = 1.45
const PREVIEW_PAD = 10

type OverlayToggles = {
  readonly collision: boolean
  readonly alpha: boolean
  readonly hurtbox: boolean
}

function cloneConfig(config: AnimationConfig): AnimationConfig {
  return parseAnimationConfig(JSON.parse(JSON.stringify(config)) as unknown)
}

type TimingDraft = {
  readonly durationMs: string
  readonly dangerousWindowStartMs: string
  readonly dangerousWindowEndMs: string
}

type TimingValidation = {
  durationMs?: string
  dangerousWindowStartMs?: string
  dangerousWindowEndMs?: string
}

function timingDraftFromConfig(config: AnimationActionConfig): TimingDraft {
  return {
    durationMs: String(config.durationMs),
    dangerousWindowStartMs:
      config.type === "primaryAttack" ? String(config.dangerousWindowStartMs) : "",
    dangerousWindowEndMs:
      config.type === "primaryAttack" ? String(config.dangerousWindowEndMs) : "",
  }
}

function wholePositiveInteger(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

function savedActionConfig(
  config: AnimationConfig,
  heroId: string,
  actionId: AnimationActionId,
): AnimationActionConfig | null {
  return config.heroes[heroId]?.actions[actionId] ?? null
}

function outlineCacheKey(stripUrl: string, frameIndex: number): string {
  return `${stripUrl}#${frameIndex}`
}

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

function DirectionPreview(props: {
  readonly cell: LadyWizardViewerCell
  readonly action: AnimationToolAction
  readonly config: AnimationActionConfig
  readonly frameIndex: number
  readonly frameCount: number
  readonly toggles: OverlayToggles
}) {
  const { cell, action, config, frameIndex, frameCount, toggles } = props
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const outlineCacheRef = useRef<Map<string, AlphaOutlineSegment[]>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    imageRef.current = null
    queueMicrotask(() => {
      setLoaded(false)
      setBroken(false)
    })
    if (cell.missing) return

    const img = new Image()
    img.decoding = "async"
    img.onload = () => {
      imageRef.current = img
      setLoaded(true)
    }
    img.onerror = () => {
      imageRef.current = null
      setBroken(true)
    }
    img.src = cell.stripUrl
  }, [cell])

  const getOutline = useCallback((img: HTMLImageElement, idx: number) => {
    const key = outlineCacheKey(cell.stripUrl, idx)
    const cached = outlineCacheRef.current.get(key)
    if (cached) return cached
    const idata = copyFrameImageData(img, idx)
    if (!idata) return []
    const segs = computeAlphaOutlineSegments(idata.data, FRAME, FRAME)
    outlineCacheRef.current.set(key, segs)
    return segs
  }, [cell.stripUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    const cw = Math.round(FRAME * PREVIEW_SCALE + PREVIEW_PAD * 2)
    const ch = Math.round(FRAME * PREVIEW_SCALE + PREVIEW_PAD * 2)
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }

    ctx.fillStyle = "#0d0d10"
    ctx.fillRect(0, 0, cw, ch)
    const cx = PREVIEW_PAD + (FRAME * PREVIEW_SCALE) / 2
    const cy = PREVIEW_PAD + FRAME * PREVIEW_SCALE

    if (cell.missing || broken || !loaded || !imageRef.current) {
      ctx.fillStyle = cell.missing ? "#b45309" : "#64748b"
      ctx.font = "12px monospace"
      ctx.textAlign = "center"
      ctx.fillText(cell.missing ? "missing" : broken ? "broken" : "loading", cw / 2, ch / 2)
      return
    }

    const img = imageRef.current
    const displayFrame = Math.min(frameIndex, Math.max(0, frameCount - 1))

    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.translate(cx, cy)
    ctx.scale(PREVIEW_SCALE, PREVIEW_SCALE)
    ctx.drawImage(img, displayFrame * FRAME, 0, FRAME, FRAME, -FRAME / 2, -FRAME, FRAME, FRAME)

    const centerpoint = spriteViewerCenterpoint()
    if (toggles.collision) {
      const movementOval = spriteViewerMovementOvalRadii()
      const combatHitbox = spriteViewerCharacterHitbox()
      ctx.strokeStyle = "rgba(20, 184, 166, 0.9)"
      ctx.lineWidth = 1 / PREVIEW_SCALE
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
      ctx.strokeStyle = "rgba(251, 146, 60, 0.95)"
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

    if (toggles.alpha) {
      ctx.strokeStyle = "rgba(56, 189, 248, 0.9)"
      ctx.lineWidth = 1 / PREVIEW_SCALE
      strokeAlphaOutlineSegments(ctx, getOutline(img, displayFrame), -FRAME / 2, -FRAME)
    }

    if (toggles.hurtbox && config.type === "primaryAttack") {
      const fps = frameRateForDuration(frameCount, config.durationMs)
      const overlay = spriteViewerAttackHurtbox(
        action.id.replace("primary:", "") as Parameters<typeof spriteViewerAttackHurtbox>[0],
        cell.direction as LadyWizardDirection,
        fps,
      )
      const dangerous = spriteViewerFrameIsDangerous(displayFrame, overlay)
      const halfArcRad = (overlay.arcDeg * Math.PI) / 360
      ctx.strokeStyle = dangerous ? "rgba(239, 68, 68, 0.98)" : "rgba(255, 255, 255, 0.75)"
      ctx.lineWidth = 1.5 / PREVIEW_SCALE
      ctx.beginPath()
      ctx.arc(
        centerpoint.x,
        centerpoint.y,
        overlay.radiusPx,
        overlay.facingRad - halfArcRad,
        overlay.facingRad + halfArcRad,
      )
      ctx.closePath()
      ctx.stroke()
    }

    ctx.restore()
  }, [action.id, broken, cell, config, frameCount, frameIndex, getOutline, loaded, toggles])

  return (
    <div
      className={[
        "rounded-xl border bg-stone-950/80 p-2 shadow-inner",
        cell.missing ? "border-amber-700/70" : "border-stone-700/80",
      ].join(" ")}
      data-testid={`animation-tool-preview-${cell.direction}`}
    >
      <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
        <span className="text-stone-300">{cell.direction}</span>
        <span className={cell.missing ? "text-amber-400" : "text-stone-500"}>
          {cell.missing ? "missing" : `${frameIndex + 1}/${frameCount}`}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="mx-auto block rounded-lg border border-black/80 bg-black"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  )
}

export function AnimationToolClient() {
  const [atlas, setAtlas] = useState<LadyWizardAtlasJson | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [config, setConfig] = useState<AnimationConfig>(() => cloneConfig(ANIMATION_CONFIG))
  const [savedConfig, setSavedConfig] = useState<AnimationConfig>(() => cloneConfig(ANIMATION_CONFIG))
  const [heroId, setHeroId] = useState(VALID_HERO_IDS[0] ?? "red_wizard")
  const [actionId, setActionId] = useState<AnimationActionId>("idle")
  const [timeMs, setTimeMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string>("")
  const [timingDrafts, setTimingDrafts] = useState<Record<string, TimingDraft>>({})
  const [toggles, setToggles] = useState<OverlayToggles>({
    collision: true,
    alpha: true,
    hurtbox: true,
  })
  const rafRef = useRef<number | null>(null)
  const lastRafRef = useRef<number>(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(ladyWizardAtlasPublicPath())
        if (!res.ok) throw new Error(`atlas ${res.status}`)
        const json = (await res.json()) as LadyWizardAtlasJson
        if (!cancelled) setAtlas(json)
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "atlas load failed")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const actions = useMemo(() => getAnimationToolActions(heroId, config), [config, heroId])
  const action = actions.find((candidate) => candidate.id === actionId) ?? actions[0]!
  const actionConfig = action.config
  const savedConfigForAction = savedActionConfig(savedConfig, heroId, action.id)
  const timingDraftKey = `${heroId}:${action.id}`
  const timingDraft = timingDrafts[timingDraftKey] ?? timingDraftFromConfig(actionConfig)
  const cells = useMemo(() => {
    if (!atlas) return []
    return buildLadyWizardViewerCells(atlas).filter((cell) => cell.atlasClipId === action.atlasClipId)
  }, [action.atlasClipId, atlas])
  const orderedCells = LADY_WIZARD_DIRECTIONS.map(
    (direction) => cells.find((cell) => cell.direction === direction)!,
  ).filter(Boolean)
  const frameCount = Math.max(1, ...orderedCells.map((cell) => cell.frameCount || cell.expectedFrames))
  const currentFrame = msToFrameIndex(timeMs, actionConfig.durationMs, frameCount)
  const missingDirections = orderedCells.filter((cell) => cell.missing).map((cell) => cell.direction)

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastRafRef.current = 0
      return
    }

    const step = (now: number) => {
      if (!lastRafRef.current) lastRafRef.current = now
      const dt = now - lastRafRef.current
      lastRafRef.current = now
      setTimeMs((prev) => (prev + dt) % actionConfig.durationMs)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastRafRef.current = 0
    }
  }, [actionConfig.durationMs, playing])

  const updateActionConfig = useCallback((next: AnimationActionConfig) => {
    setConfig((prev) => {
      const hero = prev.heroes[heroId]
      return parseAnimationConfig({
        ...prev,
        heroes: {
          ...prev.heroes,
          [heroId]: {
            actions: {
              ...hero.actions,
              [action.id]: next,
            },
          },
        },
      })
    })
  }, [action.id, heroId])

  const timingValidation = useMemo<TimingValidation>(() => {
    const durationMs = wholePositiveInteger(timingDraft.durationMs)
    const errors: TimingValidation = {}
    if (durationMs == null) {
      errors.durationMs = "Enter a whole number greater than 0."
    }

    if (actionConfig.type === "primaryAttack") {
      const dangerousWindowStartMs = wholePositiveInteger(timingDraft.dangerousWindowStartMs)
      const dangerousWindowEndMs = wholePositiveInteger(timingDraft.dangerousWindowEndMs)
      if (dangerousWindowStartMs == null) {
        errors.dangerousWindowStartMs = "Enter a whole number greater than 0."
      }
      if (dangerousWindowEndMs == null) {
        errors.dangerousWindowEndMs = "Enter a whole number greater than 0."
      }
      if (durationMs != null && dangerousWindowStartMs != null && dangerousWindowStartMs >= durationMs) {
        errors.dangerousWindowStartMs = "Start must be less than duration."
      }
      if (durationMs != null && dangerousWindowEndMs != null && dangerousWindowEndMs > durationMs) {
        errors.dangerousWindowEndMs = "End must be no greater than duration."
      }
      if (
        dangerousWindowStartMs != null &&
        dangerousWindowEndMs != null &&
        dangerousWindowStartMs >= dangerousWindowEndMs
      ) {
        errors.dangerousWindowEndMs = "End must be greater than start."
      }
    }

    return errors
  }, [actionConfig.type, timingDraft])

  const timingHasErrors = Object.keys(timingValidation).length > 0

  function setTimingDraft(next: TimingDraft) {
    setTimingDrafts((prev) => ({ ...prev, [timingDraftKey]: next }))
  }

  function commitDuration(raw: string) {
    setTimingDraft({ ...timingDraft, durationMs: raw })
    const durationMs = wholePositiveInteger(raw)
    if (durationMs == null) return
    if (actionConfig.type === "primaryAttack") {
      const dangerousWindowStartMs = wholePositiveInteger(timingDraft.dangerousWindowStartMs)
      const dangerousWindowEndMs = wholePositiveInteger(timingDraft.dangerousWindowEndMs)
      if (
        dangerousWindowStartMs == null ||
        dangerousWindowEndMs == null ||
        dangerousWindowStartMs >= dangerousWindowEndMs ||
        dangerousWindowStartMs >= durationMs ||
        dangerousWindowEndMs > durationMs
      ) {
        return
      }
      updateActionConfig({ ...actionConfig, durationMs })
    } else if (actionConfig.type === "spell" && actionConfig.effectTiming === "during") {
      if ((actionConfig.effectAtMs ?? 1) >= durationMs) return
      updateActionConfig({ ...actionConfig, durationMs })
    } else {
      updateActionConfig({ ...actionConfig, durationMs })
    }
    setTimeMs((value) => Math.min(value, durationMs - 1))
  }

  function commitDangerousStart(raw: string) {
    setTimingDraft({ ...timingDraft, dangerousWindowStartMs: raw })
    if (actionConfig.type !== "primaryAttack") return
    const dangerousWindowStartMs = wholePositiveInteger(raw)
    const dangerousWindowEndMs = wholePositiveInteger(timingDraft.dangerousWindowEndMs)
    const durationMs = wholePositiveInteger(timingDraft.durationMs)
    if (
      dangerousWindowStartMs == null ||
      dangerousWindowEndMs == null ||
      durationMs == null ||
      dangerousWindowStartMs >= dangerousWindowEndMs ||
      dangerousWindowStartMs >= durationMs ||
      dangerousWindowEndMs > durationMs
    ) {
      return
    }
    updateActionConfig({ ...actionConfig, dangerousWindowStartMs })
  }

  function commitDangerousEnd(raw: string) {
    setTimingDraft({ ...timingDraft, dangerousWindowEndMs: raw })
    if (actionConfig.type !== "primaryAttack") return
    const dangerousWindowStartMs = wholePositiveInteger(timingDraft.dangerousWindowStartMs)
    const dangerousWindowEndMs = wholePositiveInteger(raw)
    const durationMs = wholePositiveInteger(timingDraft.durationMs)
    if (
      dangerousWindowStartMs == null ||
      dangerousWindowEndMs == null ||
      durationMs == null ||
      dangerousWindowStartMs >= dangerousWindowEndMs ||
      dangerousWindowStartMs >= durationMs ||
      dangerousWindowEndMs > durationMs
    ) {
      return
    }
    updateActionConfig({ ...actionConfig, dangerousWindowEndMs })
  }

  async function save() {
    if (timingHasErrors) {
      setSaveStatus("fix timing validation before saving")
      return
    }
    setSaveStatus("saving...")
    try {
      const res = await fetch("/api/dev/animation-tool/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      })
      const body = (await res.json()) as { savedAt?: string; error?: string }
      if (!res.ok) throw new Error(body.error ?? `save failed ${res.status}`)
      setSavedConfig(cloneConfig(config))
      setSaveStatus(`saved ${body.savedAt ?? ""}`)
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "save failed")
    }
  }

  const markerCopy =
    actionConfig.type === "spell"
      ? actionConfig.effectTiming === "after"
        ? "effect fires after animation"
        : `effect fires at ${actionConfig.effectAtMs}ms, frame ${
            msToFrameIndex(actionConfig.effectAtMs ?? 0, actionConfig.durationMs, frameCount) + 1
          }, tick +${msToTickOffset(actionConfig.effectAtMs ?? 0)}`
      : actionConfig.type === "primaryAttack"
        ? `dangerous ${actionConfig.dangerousWindowStartMs}-${actionConfig.dangerousWindowEndMs}ms, frames ${
            msToFrameIndex(actionConfig.dangerousWindowStartMs, actionConfig.durationMs, frameCount) + 1
          }-${msToFrameIndex(actionConfig.dangerousWindowEndMs - 1, actionConfig.durationMs, frameCount) + 1}`
        : "timing only"

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 md:p-6">
      <header className="rounded-2xl border border-lime-700/30 bg-[radial-gradient(circle_at_top_left,#36531455,transparent_38%),linear-gradient(135deg,#1c1917,#0c0a09)] p-5 shadow-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-lime-300/80">dev-only</p>
        <h1 className="mt-2 font-mono text-2xl text-stone-50">Animation timing tool</h1>
        <p className="mt-2 max-w-3xl text-sm text-stone-300">
          Edits shared ms timing per hero/action. Frames are aid only; runtime executes on
          fixed ticks at the first tick at or after the configured ms.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="flex flex-col gap-4 rounded-2xl border border-stone-700 bg-stone-900/80 p-4">
          <label className="flex flex-col gap-1 font-mono text-xs text-stone-300">
            Hero
            <select
              className="rounded border border-stone-700 bg-stone-950 p-2 text-stone-100"
              value={heroId}
              onChange={(event) => {
                setHeroId(event.target.value)
                setTimeMs(0)
                setPlaying(false)
              }}
              data-testid="animation-tool-hero-select"
            >
              {VALID_HERO_IDS.map((id) => (
                <option key={id} value={id}>
                  {HERO_CONFIGS[id]?.displayName ?? id}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 font-mono text-xs text-stone-300">
            Action
            <select
              className="rounded border border-stone-700 bg-stone-950 p-2 text-stone-100"
              value={action.id}
              onChange={(event) => {
                setActionId(event.target.value as AnimationActionId)
                setTimeMs(0)
                setPlaying(false)
              }}
              data-testid="animation-tool-action-select"
            >
              {actions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.category}: {candidate.label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-stone-700 bg-stone-950/70 p-3">
            <div className="font-mono text-xs text-lime-200">Timing</div>
            <label className="mt-3 flex flex-col gap-1 font-mono text-xs text-stone-300">
              Duration ms
              <input
                type="text"
                inputMode="numeric"
                pattern="[1-9][0-9]*"
                className="rounded border border-stone-700 bg-stone-950 p-2"
                value={timingDraft.durationMs}
                onChange={(event) => commitDuration(event.target.value)}
              />
              {timingValidation.durationMs ? (
                <span className="text-[11px] text-red-300">{timingValidation.durationMs}</span>
              ) : null}
              <span className="text-[11px] text-stone-500">
                saved: {savedConfigForAction?.durationMs ?? "unknown"}ms
              </span>
            </label>

            {actionConfig.type === "spell" ? (
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex flex-col gap-1 font-mono text-xs text-stone-300">
                  Effect timing
                  <select
                    className="rounded border border-stone-700 bg-stone-950 p-2"
                    value={actionConfig.effectTiming}
                    onChange={(event) => {
                      const effectTiming = event.target.value as "after" | "during"
                      updateActionConfig(
                        effectTiming === "after"
                          ? { type: "spell", durationMs: actionConfig.durationMs, effectTiming }
                          : {
                              type: "spell",
                              durationMs: actionConfig.durationMs,
                              effectTiming,
                              effectAtMs: Math.max(1, Math.min(actionConfig.durationMs - 1, actionConfig.effectAtMs ?? 1)),
                            },
                      )
                    }}
                  >
                    <option value="after">After animation</option>
                    <option value="during">During animation</option>
                  </select>
                </label>
                {actionConfig.effectTiming === "during" ? (
                  <label className="flex flex-col gap-1 font-mono text-xs text-stone-300">
                    Effect at ms
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, actionConfig.durationMs - 1)}
                      className="rounded border border-stone-700 bg-stone-950 p-2"
                      value={actionConfig.effectAtMs ?? 1}
                      onChange={(event) => {
                        const requested = wholePositiveInteger(event.target.value) ?? actionConfig.effectAtMs ?? 1
                        const effectAtMs = Math.max(
                          1,
                          Math.min(actionConfig.durationMs - 1, requested),
                        )
                        updateActionConfig({ ...actionConfig, effectAtMs })
                      }}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}

            {actionConfig.type === "primaryAttack" ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 font-mono text-xs text-stone-300">
                  Dangerous start
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    className="rounded border border-stone-700 bg-stone-950 p-2"
                    value={timingDraft.dangerousWindowStartMs}
                    onChange={(event) => commitDangerousStart(event.target.value)}
                  />
                  {timingValidation.dangerousWindowStartMs ? (
                    <span className="text-[11px] text-red-300">
                      {timingValidation.dangerousWindowStartMs}
                    </span>
                  ) : null}
                  <span className="text-[11px] text-stone-500">
                    saved:{" "}
                    {savedConfigForAction?.type === "primaryAttack"
                      ? `${savedConfigForAction.dangerousWindowStartMs}ms`
                      : "n/a"}
                  </span>
                </label>
                <label className="flex flex-col gap-1 font-mono text-xs text-stone-300">
                  Dangerous end
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    className="rounded border border-stone-700 bg-stone-950 p-2"
                    value={timingDraft.dangerousWindowEndMs}
                    onChange={(event) => commitDangerousEnd(event.target.value)}
                  />
                  {timingValidation.dangerousWindowEndMs ? (
                    <span className="text-[11px] text-red-300">{timingValidation.dangerousWindowEndMs}</span>
                  ) : null}
                  <span className="text-[11px] text-stone-500">
                    saved:{" "}
                    {savedConfigForAction?.type === "primaryAttack"
                      ? `${savedConfigForAction.dangerousWindowEndMs}ms`
                      : "n/a"}
                  </span>
                </label>
              </div>
            ) : null}

            <p className="mt-3 rounded bg-black/40 p-2 font-mono text-[11px] text-stone-400">{markerCopy}</p>
          </div>

          <div className="rounded-xl border border-stone-700 bg-stone-950/70 p-3">
            <div className="font-mono text-xs text-lime-200">Overlays</div>
            {(["collision", "alpha", "hurtbox"] as const).map((key) => (
              <label key={key} className="mt-2 flex items-center gap-2 font-mono text-xs text-stone-300">
                <input
                  type="checkbox"
                  checked={toggles[key]}
                  onChange={(event) => setToggles((prev) => ({ ...prev, [key]: event.target.checked }))}
                />
                {key}
              </label>
            ))}
            <p className="mt-3 font-mono text-[11px] text-stone-500">
              Centerpoint offset: {LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y}px. Collision = teal oval + orange combat
              hitbox.
            </p>
          </div>

          <button
            type="button"
            className="rounded-xl bg-lime-500 px-4 py-3 font-mono text-sm font-bold text-stone-950 hover:bg-lime-400"
            onClick={() => void save()}
            disabled={timingHasErrors}
            data-testid="animation-tool-save"
          >
            Save snapshot
          </button>
          {saveStatus ? <p className="font-mono text-xs text-stone-400">{saveStatus}</p> : null}
          <p className="font-mono text-[11px] text-stone-500">
            Saves full config v{ANIMATION_CONFIG_SCHEMA_VERSION} to tools/animation/output, then sync with{" "}
            <code>bun run dev:animation-sync</code>.
          </p>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-2xl border border-stone-700 bg-stone-900/80 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-lg bg-orange-500 px-4 py-2 font-mono text-sm font-bold text-stone-950 hover:bg-orange-400"
                onClick={() => setPlaying((value) => !value)}
                disabled={Boolean(loadError)}
                data-testid="animation-tool-play"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <label className="flex flex-1 items-center gap-3 font-mono text-xs text-stone-300">
                Time
                <input
                  className="min-w-[180px] flex-1 accent-lime-400"
                  type="range"
                  min={0}
                  max={Math.max(0, actionConfig.durationMs - 1)}
                  value={Math.min(timeMs, actionConfig.durationMs - 1)}
                  onChange={(event) => {
                    setPlaying(false)
                    setTimeMs(Number(event.target.value))
                  }}
                  data-testid="animation-tool-scrub"
                />
                <span className="w-28 text-right">
                  {Math.round(timeMs)}ms f{currentFrame + 1}/{frameCount}
                </span>
              </label>
            </div>
            {missingDirections.length > 0 ? (
              <p className="mt-3 rounded border border-amber-700/60 bg-amber-950/30 p-2 font-mono text-xs text-amber-200">
                Missing directions: {missingDirections.join(", ")}. Save still allowed.
              </p>
            ) : null}
            {loadError ? (
              <p className="mt-3 rounded border border-red-700/60 bg-red-950/30 p-2 font-mono text-xs text-red-200">
                Failed to load atlas: {loadError}
              </p>
            ) : null}
          </section>

          <section
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="animation-tool-preview-grid"
          >
            {orderedCells.map((cell) => (
              <DirectionPreview
                key={cell.direction}
                cell={cell}
                action={action}
                config={actionConfig}
                frameIndex={Math.min(currentFrame, Math.max(0, (cell.frameCount || frameCount) - 1))}
                frameCount={cell.frameCount || cell.expectedFrames || frameCount}
                toggles={toggles}
              />
            ))}
          </section>
        </div>
      </section>
    </div>
  )
}
