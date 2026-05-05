/** Audio configuration: SFX paths, BGM paths, and crossfade constants. */

import { getBehaviorAnimationConfig } from "./animationConfig"
import { DEFAULT_HERO_ID } from "./heroes"

/** BGM crossfade duration in ms. */
export const BGM_CROSSFADE_MS = 2000

/** Battle music fade-out duration on match end, in ms. */
export const BATTLE_MUSIC_END_FADE_MS = 1500

/** Lobby music fade-out duration on match start, in ms. */
export const LOBBY_MUSIC_END_FADE_MS = 1000

/** Default BGM volume (0–100). */
export const DEFAULT_BGM_VOLUME = 70

/** Default SFX volume (0–100). */
export const DEFAULT_SFX_VOLUME = 85

/** Lobby music asset key. */
export const LOBBY_MUSIC_KEY = "music-lobby-01"
/** Lobby music asset path. */
export const LOBBY_MUSIC_PATH = "/assets/music/lobby/wizard-wars-lobby-01-ost.mp3"

/** Battle music asset keys (rotate through them). */
export const BATTLE_MUSIC_KEYS = ["music-battle-01", "music-battle-02"] as const
/** Battle music asset paths (index-aligned with BATTLE_MUSIC_KEYS). */
export const BATTLE_MUSIC_PATHS = [
  "/assets/music/battle/wizard-war-battle-ost-01.mp3",
  "/assets/music/battle/wizard-wars-battle-02-ost.mp3",
] as const

/**
 * Time between local walk footstep one-shots. Half the configured walk loop
 * duration (two steps per full walk cycle in {@link animation-config.json}).
 */
export const WALK_FOOTSTEP_INTERVAL_MS =
  getBehaviorAnimationConfig(DEFAULT_HERO_ID, "walk").durationMs / 2
/** SFX asset keys and paths. */
export const SFX_KEYS = {
  fireballCast: "sfx-fireball-cast",
  fireballImpact: "sfx-fireball-impact",
  lightningCast: "sfx-lightning-cast",
  lightningImpact: "sfx-lightning-impact",
  axeSwing: "sfx-axe-swing",
  axeHit: "sfx-axe-hit",
  walkStep: "sfx-walk-step",
  playerDeath: "sfx-player-death",
  playerHit: "sfx-player-hit",
  countdownBeep: "sfx-countdown-beep",
  countdownGo: "sfx-countdown-go",
  jump: "sfx-jump",
} as const

/** SFX concurrency caps (max simultaneous instances). */
export const SFX_CONCURRENCY: Record<string, number> = {
  [SFX_KEYS.fireballImpact]: 4,
  [SFX_KEYS.walkStep]: 2,
  [SFX_KEYS.axeSwing]: 4,
  [SFX_KEYS.playerHit]: 6,
}
