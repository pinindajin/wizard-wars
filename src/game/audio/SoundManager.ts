import Phaser from "phaser"

import { SFX_CONCURRENCY } from "@/shared/balance-config/audio"
import { DEFAULT_SFX_VOLUME } from "@/shared/balance-config/audio"

/**
 * Manages SFX playback with per-sound concurrency caps.
 * Active instance counts are tracked per key; if the cap is hit the play call is dropped.
 */
export class SoundManager {
  private scene: Phaser.Scene
  /** Maps SFX key → number of currently playing instances. */
  private activeCounts: Map<string, number> = new Map()
  /**
   * At most one active instance per key; used by {@link SoundManager.playRestarting}.
   * New plays stop and replace the previous instance (take-hit grunt).
   */
  private restartOneShotByKey: Map<string, Phaser.Sound.BaseSound> = new Map()
  /** Master volume 0–1. */
  private masterVolume: number

  /**
   * @param scene - The active Phaser scene (used to access the sound manager).
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.masterVolume = DEFAULT_SFX_VOLUME / 100
  }

  /**
   * Plays a sound effect by asset key, respecting the per-key concurrency cap.
   * Silently no-ops if the sound asset is not loaded or the concurrency cap is reached.
   *
   * @param key - The Phaser audio asset key.
   * @param volumeOverride - Optional per-call volume multiplier (0–1).
   */
  play(key: string, volumeOverride?: number): void {
    if (!this.scene.cache.audio?.exists(key)) return

    const cap = SFX_CONCURRENCY[key] ?? Infinity
    const current = this.activeCounts.get(key) ?? 0
    if (current >= cap) return

    const volume = this.masterVolume * (volumeOverride ?? 1)

    const sound = this.scene.sound.add(key, { volume })
    this.activeCounts.set(key, (this.activeCounts.get(key) ?? 0) + 1)

    sound.once("complete", () => {
      this.activeCounts.set(key, Math.max(0, (this.activeCounts.get(key) ?? 1) - 1))
      sound.destroy()
    })

    sound.play()
  }

  /**
   * Plays a one-shot, stopping any still-playing instance with the same key first.
   * Used for take-hit feedback so rapid hits restart one channel instead of stacking.
   *
   * @param key - The Phaser audio asset key.
   * @param volumeOverride - Optional per-call volume multiplier (0–1).
   */
  playRestarting(key: string, volumeOverride?: number): void {
    if (!this.scene.cache.audio?.exists(key)) return

    const prev = this.restartOneShotByKey.get(key)
    if (prev) {
      prev.stop()
      prev.destroy()
      this.restartOneShotByKey.delete(key)
    }

    const volume = this.masterVolume * (volumeOverride ?? 1)
    const sound = this.scene.sound.add(key, { volume })
    this.restartOneShotByKey.set(key, sound)

    sound.once("complete", () => {
      if (this.restartOneShotByKey.get(key) === sound) {
        this.restartOneShotByKey.delete(key)
      }
      sound.destroy()
    })

    sound.play()
  }

  /**
   * Sets the master SFX volume for all future play calls.
   *
   * @param volume - Volume in the range 0–100.
   */
  setMasterSfxVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume / 100))
  }
}
