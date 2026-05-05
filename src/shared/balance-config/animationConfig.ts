import { z } from "zod"

import animationConfigJson from "./animation-config.json"
import { ABILITY_CONFIGS } from "./abilities"
import { DEFAULT_HERO_ID, HERO_CONFIGS, type HeroConfig } from "./heroes"
import {
  PRIMARY_MELEE_ATTACK_CONFIGS,
  type PrimaryMeleeAttackId,
} from "./equipment"
import { TICK_MS } from "./rendering"
import {
  LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET,
  LADY_WIZARD_CLIP_FRAMES,
  type LadyWizardAtlasClipId,
  type LadyWizardMegasheetClip,
} from "../sprites/ladyWizard"

export const ANIMATION_CONFIG_SCHEMA_VERSION = 1

export const animationEffectTimingSchema = z.enum(["before", "after", "during"])

const durationMsSchema = z.number().int().positive()

/** Optional per-frame durations in ms; when set, length must match clip frame count and sum to `durationMs`. */
const frameDurationsMsSchema = z.array(z.number().int().positive())

export const behaviorAnimationActionSchema = z.object({
  type: z.literal("behavior"),
  durationMs: durationMsSchema,
  frameDurationsMs: frameDurationsMsSchema.optional(),
})

export const spellAnimationActionSchema = z
  .object({
    type: z.literal("spell"),
    durationMs: durationMsSchema,
    effectTiming: animationEffectTimingSchema,
    effectAtMs: z.number().int().positive().optional(),
    frameDurationsMs: frameDurationsMsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.effectTiming === "during") {
      if (value.effectAtMs === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["effectAtMs"],
          message: "during spell effects need effectAtMs",
        })
      } else if (value.effectAtMs >= value.durationMs) {
        ctx.addIssue({
          code: "custom",
          path: ["effectAtMs"],
          message: "effectAtMs must be greater than 0 and less than durationMs",
        })
      }
    }
    if (
      (value.effectTiming === "before" || value.effectTiming === "after") &&
      value.effectAtMs !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["effectAtMs"],
        message: `${value.effectTiming} spell effects must not include effectAtMs`,
      })
    }
  })

export const primaryAttackAnimationActionSchema = z
  .object({
    type: z.literal("primaryAttack"),
    durationMs: durationMsSchema,
    dangerousWindowStartMs: z.number().int().min(0),
    dangerousWindowEndMs: z.number().int().positive(),
    frameDurationsMs: frameDurationsMsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dangerousWindowEndMs <= value.dangerousWindowStartMs) {
      ctx.addIssue({
        code: "custom",
        path: ["dangerousWindowEndMs"],
        message: "dangerousWindowEndMs must be greater than dangerousWindowStartMs",
      })
    }
    if (value.dangerousWindowEndMs > value.durationMs) {
      ctx.addIssue({
        code: "custom",
        path: ["dangerousWindowEndMs"],
        message: "dangerous window must end at or before durationMs",
      })
    }
  })

export const animationActionConfigSchema = z.discriminatedUnion("type", [
  behaviorAnimationActionSchema,
  spellAnimationActionSchema,
  primaryAttackAnimationActionSchema,
])

/**
 * Megasheet clip whose frame count must match `frameDurationsMs` length for a hero action key.
 *
 * @param actionKey - Key under `heroes[*].actions` (e.g. `idle`, `spell:fireball`, `primary:red_wizard_cleaver`).
 * @returns Megasheet clip id for `LADY_WIZARD_CLIP_FRAMES`.
 */
export function megasheetClipForAnimationActionKey(actionKey: string): LadyWizardMegasheetClip {
  switch (actionKey) {
    case "idle":
      return "breathing_idle"
    case "walk":
      return "walk"
    case "death":
      return "death"
    case "stumble":
      return "stumble"
    default:
      break
  }
  if (actionKey.startsWith("spell:")) {
    const abilityId = actionKey.slice("spell:".length)
    if (abilityId === "fireball") return "light_spell_cast"
    if (abilityId === "jump") return "jump"
    return "heavy_spell_cast"
  }
  if (actionKey.startsWith("primary:")) return "summoned_axe_swing"
  throw new Error(`Unknown animation action key: ${actionKey}`)
}

export const animationConfigSchema = z.object({
  schemaVersion: z.literal(ANIMATION_CONFIG_SCHEMA_VERSION),
  heroes: z.record(
    z.string(),
    z.object({
      actions: z.record(z.string(), animationActionConfigSchema),
    }),
  ),
}).superRefine((value, ctx) => {
  const allowedHeroIds = new Set(Object.keys(HERO_CONFIGS))
  for (const heroId of Object.keys(value.heroes)) {
    if (!allowedHeroIds.has(heroId)) {
      ctx.addIssue({
        code: "custom",
        path: ["heroes", heroId],
        message: `unknown hero id ${heroId}`,
      })
    }
  }

  for (const [heroId, hero] of Object.entries(HERO_CONFIGS)) {
    const heroConfig = value.heroes[heroId]
    if (!heroConfig) {
      ctx.addIssue({
        code: "custom",
        path: ["heroes", heroId],
        message: `missing hero ${heroId}`,
      })
      continue
    }
    const expected = new Set<string>([
      "idle",
      "walk",
      "death",
      "stumble",
      ...Object.keys(ABILITY_CONFIGS).map(spellActionId),
      primaryAttackActionId(hero.primaryMeleeAttackId),
    ])
    for (const key of expected) {
      if (!heroConfig.actions[key]) {
        ctx.addIssue({
          code: "custom",
          path: ["heroes", heroId, "actions", key],
          message: `missing action ${key}`,
        })
      }
    }
    for (const key of Object.keys(heroConfig.actions)) {
      if (!expected.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["heroes", heroId, "actions", key],
          message: `unexpected action ${key}; direction-specific timing is not allowed`,
        })
      }
    }

    for (const [actionKey, action] of Object.entries(heroConfig.actions)) {
      const fd = "frameDurationsMs" in action ? action.frameDurationsMs : undefined
      if (fd === undefined) continue
      const clip = megasheetClipForAnimationActionKey(actionKey)
      const expectedFrames = LADY_WIZARD_CLIP_FRAMES[clip]
      if (fd.length !== expectedFrames) {
        ctx.addIssue({
          code: "custom",
          path: ["heroes", heroId, "actions", actionKey, "frameDurationsMs"],
          message: `frameDurationsMs length must be ${String(expectedFrames)} for ${actionKey} (${clip})`,
        })
        continue
      }
      const sum = fd.reduce((a, b) => a + b, 0)
      if (sum !== action.durationMs) {
        ctx.addIssue({
          code: "custom",
          path: ["heroes", heroId, "actions", actionKey, "frameDurationsMs"],
          message: "frameDurationsMs must sum to durationMs",
        })
      }
    }
  }
})

export const animationToolSaveSchema = z.object({
  schemaVersion: z.literal(ANIMATION_CONFIG_SCHEMA_VERSION),
  savedAt: z.string().datetime(),
  config: animationConfigSchema,
})

export type AnimationEffectTiming = z.infer<typeof animationEffectTimingSchema>
export type BehaviorAnimationActionConfig = z.infer<typeof behaviorAnimationActionSchema>
export type SpellAnimationActionConfig = z.infer<typeof spellAnimationActionSchema>
export type PrimaryAttackAnimationActionConfig = z.infer<
  typeof primaryAttackAnimationActionSchema
>
export type AnimationActionConfig = z.infer<typeof animationActionConfigSchema>
export type AnimationConfig = z.infer<typeof animationConfigSchema>
export type AnimationToolSave = z.infer<typeof animationToolSaveSchema>

export type AnimationBehaviorActionId = "idle" | "walk" | "death" | "stumble"
export type AnimationSpellActionId = `spell:${string}`
export type AnimationPrimaryAttackActionId = `primary:${PrimaryMeleeAttackId}`
export type AnimationActionId =
  | AnimationBehaviorActionId
  | AnimationSpellActionId
  | AnimationPrimaryAttackActionId

export type AnimationToolAction = {
  readonly id: AnimationActionId
  readonly label: string
  readonly category: "Behavior" | "Spell" | "Attack"
  readonly atlasClipId: LadyWizardAtlasClipId
  readonly megasheetClip: LadyWizardMegasheetClip
  readonly config: AnimationActionConfig
}

export function parseAnimationConfig(value: unknown): AnimationConfig {
  return animationConfigSchema.parse(value)
}

export function parseAnimationToolSave(value: unknown): AnimationToolSave {
  return animationToolSaveSchema.parse(value)
}

export const ANIMATION_CONFIG = parseAnimationConfig(animationConfigJson)

export function msToTicksCeil(ms: number): number {
  return Math.ceil(ms / TICK_MS)
}

export function msToTickOffset(ms: number): number {
  return msToTicksCeil(ms)
}

export function msToFrameIndex(ms: number, durationMs: number, frameCount: number): number {
  if (durationMs <= 0 || frameCount <= 0) return 0
  return Math.min(frameCount - 1, Math.floor((ms / durationMs) * frameCount))
}

/**
 * Maps elapsed ms to frame index using per-frame durations (half-open intervals per frame).
 *
 * @param ms - Elapsed time in ms since animation start.
 * @param frameDurationsMs - Positive duration of each frame in order.
 * @returns 0-based frame index clamped to the last frame.
 */
export function msToFrameIndexFromDurations(ms: number, frameDurationsMs: readonly number[]): number {
  if (frameDurationsMs.length === 0) return 0
  let start = 0
  for (let i = 0; i < frameDurationsMs.length; i++) {
    const d = frameDurationsMs[i]!
    if (ms < start + d) return i
    start += d
  }
  return frameDurationsMs.length - 1
}

/**
 * Returns cumulative start time in ms for each frame from optional per-frame durations, or uniform splits.
 *
 * @param durationMs - Total animation length.
 * @param frameCount - Number of frames.
 * @param frameDurationsMs - When present and length matches `frameCount`, used as authoritative segment lengths.
 * @returns Array of length `frameCount` with start ms for each frame.
 */
export function frameStartMsList(
  durationMs: number,
  frameCount: number,
  frameDurationsMs: readonly number[] | undefined,
): number[] {
  if (frameCount <= 0) return []
  if (
    frameDurationsMs !== undefined &&
    frameDurationsMs.length === frameCount &&
    frameDurationsMs.length > 0
  ) {
    let t = 0
    return frameDurationsMs.map((d) => {
      const s = t
      t += d
      return s
    })
  }
  return Array.from({ length: frameCount }, (_, i) =>
    Math.floor((i * durationMs) / frameCount),
  )
}

/**
 * Resolves which frame index `ms` falls into using either uniform timing or `frameDurationsMs`.
 *
 * @param ms - Elapsed ms.
 * @param durationMs - Total duration.
 * @param frameCount - Frame count for the clip.
 * @param frameDurationsMs - Optional per-frame durations (length must match `frameCount` when used).
 */
export function msToFrameIndexForAction(
  ms: number,
  durationMs: number,
  frameCount: number,
  frameDurationsMs: readonly number[] | undefined,
): number {
  if (
    frameDurationsMs !== undefined &&
    frameDurationsMs.length === frameCount &&
    frameCount > 0
  ) {
    return msToFrameIndexFromDurations(ms, frameDurationsMs)
  }
  return msToFrameIndex(ms, durationMs, frameCount)
}

export function frameRateForDuration(frameCount: number, durationMs: number): number {
  if (frameCount <= 0 || durationMs <= 0) return 1
  return frameCount / (durationMs / 1000)
}

export function spellActionId(abilityId: string): AnimationSpellActionId {
  return `spell:${abilityId}`
}

export function primaryAttackActionId(
  attackId: PrimaryMeleeAttackId,
): AnimationPrimaryAttackActionId {
  return `primary:${attackId}`
}

function heroConfigFor(heroId: string): HeroConfig {
  return HERO_CONFIGS[heroId] ?? HERO_CONFIGS[DEFAULT_HERO_ID]
}

export function getAnimationActionConfig(
  heroId: string,
  actionId: AnimationActionId,
  config: AnimationConfig = ANIMATION_CONFIG,
): AnimationActionConfig {
  const action =
    config.heroes[heroId]?.actions[actionId] ??
    config.heroes[DEFAULT_HERO_ID]?.actions[actionId] ??
    ANIMATION_CONFIG.heroes[DEFAULT_HERO_ID].actions[actionId]
  if (!action) throw new Error(`Missing animation action ${actionId}`)
  return action
}

export function getBehaviorAnimationConfig(
  heroId: string,
  actionId: AnimationBehaviorActionId,
  config: AnimationConfig = ANIMATION_CONFIG,
): BehaviorAnimationActionConfig {
  const action = getAnimationActionConfig(heroId, actionId, config)
  if (action.type !== "behavior") throw new Error(`Animation action ${actionId} is not behavior`)
  return action
}

export function getSpellAnimationConfig(
  heroId: string,
  abilityId: string,
  config: AnimationConfig = ANIMATION_CONFIG,
): SpellAnimationActionConfig {
  const actionId = spellActionId(abilityId)
  const action = getAnimationActionConfig(heroId, actionId, config)
  if (action.type !== "spell") throw new Error(`Animation action ${actionId} is not spell`)
  return action
}

export function getPrimaryAttackAnimationConfig(
  heroId: string,
  attackId: PrimaryMeleeAttackId,
  config: AnimationConfig = ANIMATION_CONFIG,
): PrimaryAttackAnimationActionConfig {
  const actionId = primaryAttackActionId(attackId)
  const action = getAnimationActionConfig(heroId, actionId, config)
  if (action.type !== "primaryAttack") {
    throw new Error(`Animation action ${actionId} is not primary attack`)
  }
  return action
}

export function getPrimaryAttackAnimationConfigByAttackId(
  attackId: PrimaryMeleeAttackId,
  config: AnimationConfig = ANIMATION_CONFIG,
): PrimaryAttackAnimationActionConfig {
  for (const [heroId, hero] of Object.entries(HERO_CONFIGS)) {
    if (hero.primaryMeleeAttackId === attackId) {
      return getPrimaryAttackAnimationConfig(heroId, attackId, config)
    }
  }
  return getPrimaryAttackAnimationConfig(
    DEFAULT_HERO_ID,
    HERO_CONFIGS[DEFAULT_HERO_ID].primaryMeleeAttackId,
    config,
  )
}

export function getAnimationToolActions(
  heroId: string,
  config: AnimationConfig = ANIMATION_CONFIG,
): readonly AnimationToolAction[] {
  const hero = heroConfigFor(heroId)
  const actions = config.heroes[hero.id]?.actions ?? config.heroes[DEFAULT_HERO_ID].actions
  const primaryId = hero.primaryMeleeAttackId

  return [
    {
      id: "idle",
      label: "Idle",
      category: "Behavior",
      atlasClipId: "idle",
      megasheetClip: LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET.idle,
      config: actions.idle,
    },
    {
      id: "walk",
      label: "Walk",
      category: "Behavior",
      atlasClipId: "walk",
      megasheetClip: LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET.walk,
      config: actions.walk,
    },
    {
      id: "death",
      label: "Death",
      category: "Behavior",
      atlasClipId: "death",
      megasheetClip: LADY_WIZARD_ATLAS_CLIP_TO_MEGASHEET.death,
      config: actions.death,
    },
    ...Object.values(ABILITY_CONFIGS).map((ability): AnimationToolAction => {
      const light = ability.id === "fireball"
      const jump = ability.id === "jump"
      return {
        id: spellActionId(ability.id),
        label: ability.displayName,
        category: "Spell" as const,
        atlasClipId: light
          ? ("light-spell-cast" as const)
          : jump
            ? ("jump" as const)
            : ("heavy-spell-cast" as const),
        megasheetClip: light
          ? ("light_spell_cast" as const)
          : jump
            ? ("jump" as const)
            : ("heavy_spell_cast" as const),
        config: actions[spellActionId(ability.id)],
      }
    }),
    {
      id: primaryAttackActionId(primaryId),
      label: PRIMARY_MELEE_ATTACK_CONFIGS[primaryId].displayName,
      category: "Attack",
      atlasClipId: "summoned-axe-attack",
      megasheetClip: "summoned_axe_swing",
      config: actions[primaryAttackActionId(primaryId)],
    },
  ]
}
