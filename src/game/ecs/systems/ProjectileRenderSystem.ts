import type Phaser from "phaser"

import type {
  FireballLaunchPayload,
  FireballBatchUpdatePayload,
  FireballSnapshot,
} from "@/shared/types"
import { ClientFireball } from "../components"
import {
  FIREBALL_FLY_ANIM,
  FIREBALL_FLY_TEXTURE,
} from "../../animation/FireballAnimDefs"

/** Depth for fireball sprites — renders above tilemap, below name tags. */
const FIREBALL_DEPTH = 10
/** Scale applied to the fireball sprite (256-px source → ~50-px sprite). */
const FIREBALL_SCALE = 0.2

/** Phaser texture key for the trail particle. */
const EMBER_TEXTURE = "ember"
/** Particles emitted per second along the trail. */
const EMBER_FREQUENCY_MS = 28
/** How long each ember stays alive (ms). */
const EMBER_LIFESPAN_MS = 320
/** Velocity envelope so embers drift slightly outward and decelerate quickly. */
const EMBER_SPEED_MIN = 8
const EMBER_SPEED_MAX = 36
/** Slight scale falloff so embers shrink as they fade. */
const EMBER_SCALE_START = 0.9
const EMBER_SCALE_END = 0.05
/** Warm color ramp for embers. */
const EMBER_TINTS = [0xffff80, 0xffaa33, 0xff5500] as const
/** `Phaser.BlendModes.ADD` numeric value, inlined to keep imports type-only. */
const BLEND_MODE_ADD = 1

/**
 * Manages Phaser sprites and ember-trail particle emitters for all active
 * fireball projectiles. Spawns sprites on `FireballLaunch`, advances them
 * each frame, and destroys both the sprite and its trailing emitter on impact
 * or resync.
 */
export class ProjectileRenderSystem {
  private scene: Phaser.Scene
  private sprites: Map<number, Phaser.GameObjects.Sprite> = new Map()
  private emitters: Map<number, Phaser.GameObjects.Particles.ParticleEmitter> =
    new Map()

  /**
   * @param scene - The Arena scene instance.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /**
   * Spawns a fireball sprite and its ember-trail emitter.
   *
   * Idempotent for the same id: a second call destroys and respawns so the
   * sprite snaps to the latest authoritative position. The emitter is created
   * with `startFollow` so the trail origin tracks the sprite as it moves.
   *
   * @param payload - FireballLaunch event data from the server.
   */
  spawnFireball(payload: FireballLaunchPayload): void {
    if (this.sprites.has(payload.id)) {
      this.destroyFireball(payload.id)
    }

    ClientFireball[payload.id] = {
      x: payload.x,
      y: payload.y,
      vx: payload.vx,
      vy: payload.vy,
      ownerId: payload.ownerId,
    }

    const sprite = this.scene.add.sprite(payload.x, payload.y, FIREBALL_FLY_TEXTURE)
    sprite.setScale(FIREBALL_SCALE)
    sprite.setDepth(FIREBALL_DEPTH)

    if (this.scene.anims.exists(FIREBALL_FLY_ANIM)) {
      sprite.play(FIREBALL_FLY_ANIM)
    }

    const angle = Math.atan2(payload.vy, payload.vx)
    sprite.setRotation(angle)

    this.sprites.set(payload.id, sprite)

    const emitter = this._createEmberEmitter(payload.x, payload.y)
    if (emitter) {
      emitter.startFollow(sprite)
      this.emitters.set(payload.id, emitter)
    }
  }

  /**
   * Replaces all client fireballs from a full `GameStateSync` snapshot
   * (reconnect / resync). Existing sprites and emitters are torn down before
   * the new set is spawned so nothing is left orphaned in the scene graph.
   *
   * @param fireballs - Authoritative fireball rows from the server.
   */
  applyFullSyncFireballs(fireballs: readonly FireballSnapshot[]): void {
    for (const id of [...this.sprites.keys()]) {
      this.destroyFireball(id)
    }
    for (const s of fireballs) {
      this.spawnFireball({
        id: s.id,
        ownerId: s.ownerId,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
      })
    }
  }

  /**
   * Applies a batch position update for all active fireballs.
   *
   * @param payload - FireballBatchUpdate event data from the server.
   */
  applyBatchUpdate(payload: FireballBatchUpdatePayload): void {
    for (const delta of payload.deltas) {
      const fb = ClientFireball[delta.id]
      if (fb) {
        fb.x = delta.x
        fb.y = delta.y
      }
      const sprite = this.sprites.get(delta.id)
      if (sprite) {
        sprite.setPosition(delta.x, delta.y)
      }
    }
    for (const removedId of payload.removedIds) {
      this.destroyFireball(removedId)
    }
  }

  /**
   * Destroys the sprite + trailing emitter for a fireball that has impacted
   * or expired. Emitter is stopped before destruction so any in-flight
   * particles fade naturally rather than vanishing instantly.
   *
   * @param id - Fireball entity id to remove.
   */
  destroyFireball(id: number): void {
    const emitter = this.emitters.get(id)
    if (emitter) {
      emitter.stop()
      emitter.destroy()
      this.emitters.delete(id)
    }
    const sprite = this.sprites.get(id)
    if (sprite) {
      sprite.destroy()
      this.sprites.delete(id)
    }
    delete ClientFireball[id]
  }

  /**
   * Per-frame update: client-side prediction of fireball positions between
   * server ticks. Emitters auto-track via `startFollow` so no manual position
   * sync is required here.
   *
   * @param delta - Frame delta time in ms.
   */
  update(delta: number): void {
    const dt = delta / 1000
    for (const [id, sprite] of this.sprites) {
      const fb = ClientFireball[id]
      if (!fb) continue
      fb.x += fb.vx * dt
      fb.y += fb.vy * dt
      sprite.setPosition(fb.x, fb.y)
    }
  }

  /** Destroys all active fireball sprites and emitters. Call on scene shutdown. */
  destroy(): void {
    for (const [id] of this.sprites) {
      this.destroyFireball(id)
    }
    // Defensive: any emitter without a sprite (shouldn't happen) gets cleaned up.
    for (const [id] of this.emitters) {
      this.destroyFireball(id)
    }
  }

  /**
   * Creates a Phaser 4 `ParticleEmitter` configured as a small ember trail.
   * Returns `null` if the engine build lacks particles or the texture is
   * missing — the projectile remains usable without a trail in that case.
   */
  private _createEmberEmitter(
    x: number,
    y: number,
  ): Phaser.GameObjects.Particles.ParticleEmitter | null {
    const addParticles = this.scene.add.particles
    if (typeof addParticles !== "function") return null
    if (this.scene.textures && !this.scene.textures.exists(EMBER_TEXTURE)) {
      return null
    }
    const emitter = this.scene.add.particles(x, y, EMBER_TEXTURE, {
      lifespan: EMBER_LIFESPAN_MS,
      frequency: EMBER_FREQUENCY_MS,
      speed: { min: EMBER_SPEED_MIN, max: EMBER_SPEED_MAX },
      scale: { start: EMBER_SCALE_START, end: EMBER_SCALE_END },
      alpha: { start: 1, end: 0 },
      tint: EMBER_TINTS as unknown as number[],
      blendMode: BLEND_MODE_ADD,
      angle: { min: 0, max: 360 },
    })
    emitter.setDepth(FIREBALL_DEPTH - 1)
    return emitter
  }
}
