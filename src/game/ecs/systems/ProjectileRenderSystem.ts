import type Phaser from "phaser"

import type {
  FireballLaunchPayload,
  FireballBatchUpdatePayload,
  FireballSnapshot,
} from "@/shared/types"
import {
  TICK_DT_SEC,
  TICK_MS,
} from "@/shared/balance-config/rendering"
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
 * Maximum catch-up budget for the fixed-step sim accumulator. Mirrors
 * {@link PlayerRenderSystem}'s `MAX_SIM_LAG_MS` so a long tab-hitch
 * can't force the system to replay seconds of projectile motion in
 * one frame.
 */
const MAX_SIM_LAG_MS = 250

/** Per-fireball render state: sprite + optional ember trail + sim interpolation. */
interface FireballRenderEntry {
  sprite: Phaser.GameObjects.Sprite
  emitter: Phaser.GameObjects.Particles.ParticleEmitter | null
  simPrevX: number
  simPrevY: number
  simCurrX: number
  simCurrY: number
}

/**
 * Manages Phaser sprites and ember-trail particle emitters for all active
 * fireball projectiles. Spawns sprites on `FireballLaunch`, advances their
 * positions each sim tick (`TICK_DT_SEC` fixed step, matching the server's
 * integration math), interpolates between the last two committed sim states
 * for the render pass, and destroys sprite + emitter on impact or resync.
 * Emitters are created at world (0, 0) and use `startFollow(sprite)` so the
 * trail tracks the lerped position without double-applying world translation.
 */
export class ProjectileRenderSystem {
  private scene: Phaser.Scene
  private entries: Map<number, FireballRenderEntry> = new Map()
  private simAccumulatorMs = 0

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
    if (this.entries.has(payload.id)) {
      this.destroyFireball(payload.id)
    }

    ClientFireball[payload.id] = {
      x: payload.x,
      y: payload.y,
      vx: payload.vx,
      vy: payload.vy,
      ownerId: payload.ownerId,
    }

    const sprite = this.scene.add.sprite(
      payload.x,
      payload.y,
      FIREBALL_FLY_TEXTURE,
    )
    sprite.setScale(FIREBALL_SCALE)
    sprite.setDepth(FIREBALL_DEPTH)

    if (this.scene.anims.exists(FIREBALL_FLY_ANIM)) {
      sprite.play(FIREBALL_FLY_ANIM)
    }

    const angle = Math.atan2(payload.vy, payload.vx)
    sprite.setRotation(angle)

    const emitter = this._createEmberEmitter()
    if (emitter) {
      emitter.startFollow(sprite)
    }

    this.entries.set(payload.id, {
      sprite,
      emitter,
      simPrevX: payload.x,
      simPrevY: payload.y,
      simCurrX: payload.x,
      simCurrY: payload.y,
    })
  }

  /**
   * Replaces all client fireballs from a full `GameStateSync` snapshot
   * (reconnect / resync). Existing sprites and emitters are torn down before
   * the new set is spawned so nothing is left orphaned in the scene graph.
   *
   * @param fireballs - Authoritative fireball rows from the server.
   */
  applyFullSyncFireballs(fireballs: readonly FireballSnapshot[]): void {
    for (const id of [...this.entries.keys()]) {
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
   * Applies a batch position update for all active fireballs. Each
   * authoritative position collapses both `simPrev` and `simCurr` for
   * that fireball onto the server value so the next render step does
   * not interpolate *through* the correction.
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
      const entry = this.entries.get(delta.id)
      if (entry) {
        entry.simPrevX = delta.x
        entry.simPrevY = delta.y
        entry.simCurrX = delta.x
        entry.simCurrY = delta.y
        entry.sprite.setPosition(delta.x, delta.y)
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
    const entry = this.entries.get(id)
    if (entry) {
      if (entry.emitter) {
        entry.emitter.stop()
        entry.emitter.destroy()
      }
      entry.sprite.destroy()
      this.entries.delete(id)
    }
    delete ClientFireball[id]
  }

  /**
   * Main per-frame update. Drives the fixed-step accumulator, advances
   * each fireball's `simCurr` by one `TICK_DT_SEC` per committed tick
   * (matching the server's integration math and {@link
   * PlayerRenderSystem}'s cadence), then renders each sprite at
   * `lerp(simPrev, simCurr, alpha)` where `alpha = accumulator / TICK_MS`.
   * Trail emitters follow each sprite via `startFollow`, so they track the
   * interpolated render position automatically.
   *
   * @param delta - Frame delta time in ms.
   */
  update(delta: number): void {
    this.simAccumulatorMs = Math.min(
      this.simAccumulatorMs + delta,
      MAX_SIM_LAG_MS,
    )
    while (this.simAccumulatorMs >= TICK_MS) {
      this.simAccumulatorMs -= TICK_MS
      this._simStep()
    }
    const alpha = TICK_MS > 0 ? this.simAccumulatorMs / TICK_MS : 0
    this._renderStep(alpha)
  }

  private _simStep(): void {
    for (const [id, entry] of this.entries) {
      const fb = ClientFireball[id]
      if (!fb) continue
      entry.simPrevX = entry.simCurrX
      entry.simPrevY = entry.simCurrY
      entry.simCurrX += fb.vx * TICK_DT_SEC
      entry.simCurrY += fb.vy * TICK_DT_SEC
      // Keep ClientFireball in sync with the committed sim position so
      // collision tests and debug tooling see the same "canonical"
      // position the renderer is interpolating between.
      fb.x = entry.simCurrX
      fb.y = entry.simCurrY
    }
  }

  private _renderStep(alpha: number): void {
    for (const [, entry] of this.entries) {
      const x =
        entry.simPrevX + (entry.simCurrX - entry.simPrevX) * alpha
      const y =
        entry.simPrevY + (entry.simCurrY - entry.simPrevY) * alpha
      entry.sprite.setPosition(x, y)
    }
  }

  /** Destroys all active fireball sprites and emitters. Call on scene shutdown. */
  destroy(): void {
    for (const [id] of this.entries) {
      this.destroyFireball(id)
    }
  }

  /**
   * Creates a Phaser 4 `ParticleEmitter` configured as a small ember trail.
   * The emitter is placed at world (0, 0): `startFollow` injects the sprite’s
   * world x/y into particles as local offsets, and the renderer multiplies
   * emitter world matrix × particle matrix — a non-zero emitter position would
   * double-apply spawn translation and detach the trail from the sprite.
   * Returns `null` if the engine build lacks particles or the texture is
   * missing — the projectile remains usable without a trail in that case.
   */
  private _createEmberEmitter(): Phaser.GameObjects.Particles.ParticleEmitter | null {
    const addParticles = this.scene.add.particles
    if (typeof addParticles !== "function") return null
    if (this.scene.textures && !this.scene.textures.exists(EMBER_TEXTURE)) {
      return null
    }
    const emitter = this.scene.add.particles(0, 0, EMBER_TEXTURE, {
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
