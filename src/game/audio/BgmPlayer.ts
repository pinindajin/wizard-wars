import Phaser from "phaser"

import {
  BGM_CROSSFADE_MS,
  LOBBY_MUSIC_KEY,
  BATTLE_MUSIC_KEYS,
  DEFAULT_BGM_VOLUME,
} from "@/shared/balance-config/audio"

/**
 * Manages background music playback: lobby loop, battle track rotation, and cross-fading.
 */
export class BgmPlayer {
  private scene: Phaser.Scene
  private currentTrack: Phaser.Sound.BaseSound | null = null
  private nextTrack: Phaser.Sound.BaseSound | null = null
  /** Master BGM volume 0–1. */
  private masterVolume: number
  private _muted = false
  private battleTrackIndex = 0

  /**
   * @param scene - The active Phaser scene.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.masterVolume = DEFAULT_BGM_VOLUME / 100
  }

  /**
   * Starts looping the lobby music track.
   * Cross-fades from any currently playing track.
   */
  startLobbyMusic(): void {
    this._crossFadeTo(LOBBY_MUSIC_KEY, true)
  }

  /**
   * Starts the next battle music track in the rotation.
   * Cross-fades from the current track and auto-advances to the next on completion.
   */
  startBattleMusic(): void {
    const key = BATTLE_MUSIC_KEYS[this.battleTrackIndex % BATTLE_MUSIC_KEYS.length]
    this._crossFadeTo(key, false)

    if (this.nextTrack) {
      this.nextTrack.once("complete", () => {
        this.battleTrackIndex++
        this.startBattleMusic()
      })
    }
  }

  /**
   * Fades all playing BGM to silence over the specified duration.
   *
   * @param fadeDurationMs - Duration of the fade-out in ms.
   */
  stopAll(fadeDurationMs: number): void {
    if (this.currentTrack && this.currentTrack.isPlaying) {
      this._fadeOut(this.currentTrack as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound, fadeDurationMs)
    }
    if (this.nextTrack && this.nextTrack.isPlaying) {
      this._fadeOut(this.nextTrack as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound, fadeDurationMs)
    }
  }

  /**
   * Sets the master BGM volume for all future track plays and adjusts currently playing tracks.
   *
   * @param volume - Volume in range 0–100.
   */
  setMasterBgmVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume / 100))
    const sound = this.currentTrack as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | null
    if (sound?.isPlaying && !this._muted) {
      sound.setVolume(this.masterVolume)
    }
  }

  /**
   * Pauses or resumes all BGM (lobby or battle).
   * Useful for muting during UI dialogs without losing position.
   *
   * @param muted - True to pause BGM, false to resume.
   */
  setMuted(muted: boolean): void {
    this._muted = muted
    const sound = this.currentTrack as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | null
    if (!sound) return
    if (muted) {
      sound.pause()
    } else {
      sound.resume()
    }
  }

  /**
   * Cross-fades from the current track to a new track over BGM_CROSSFADE_MS.
   *
   * @param key - Asset key of the track to fade in.
   * @param loop - Whether the new track should loop.
   */
  private _crossFadeTo(key: string, loop: boolean): void {
    if (!this.scene.cache.audio.exists(key)) return

    const incomingTrack = this.scene.sound.add(key, {
      volume: 0,
      loop,
    }) as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound

    incomingTrack.play()
    this.nextTrack = incomingTrack

    if (this.currentTrack && this.currentTrack.isPlaying) {
      this._fadeOut(
        this.currentTrack as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound,
        BGM_CROSSFADE_MS,
      )
    }

    this._fadeIn(incomingTrack, BGM_CROSSFADE_MS)

    this.scene.time.delayedCall(BGM_CROSSFADE_MS, () => {
      this.currentTrack = incomingTrack
      this.nextTrack = null
    })
  }

  /**
   * Tweens a sound's volume from its current level to 0, then destroys it.
   *
   * @param sound - The sound to fade out.
   * @param durationMs - Duration of the fade in ms.
   */
  private _fadeOut(
    sound: Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound,
    durationMs: number,
  ): void {
    this.scene.tweens.add({
      targets: sound,
      volume: 0,
      duration: durationMs,
      onComplete: () => {
        sound.stop()
        sound.destroy()
      },
    })
  }

  /**
   * Tweens a sound's volume from 0 to the master volume level.
   *
   * @param sound - The sound to fade in.
   * @param durationMs - Duration of the fade in ms.
   */
  private _fadeIn(
    sound: Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound,
    durationMs: number,
  ): void {
    this.scene.tweens.add({
      targets: sound,
      volume: this._muted ? 0 : this.masterVolume,
      duration: durationMs,
    })
  }
}
