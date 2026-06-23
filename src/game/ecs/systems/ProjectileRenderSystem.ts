import type Phaser from "phaser"

import type {
  FireballLaunchPayload,
  FireballBatchUpdatePayload,
  FireballSnapshot,
  GameNetTimingPayload,
  HomingOrbBatchUpdatePayload,
  HomingOrbLaunchPayload,
  HomingOrbSnapshot,
} from "@/shared/types"
import {
  resolveGameNetTiming,
  TICK_DT_SEC,
  TICK_MS,
} from "@/shared/balance-config/rendering"
import { ClientFireball, ClientHomingOrb } from "../components"
import { RemoteInterpolationBuffer } from "./RemoteInterpolationBuffer"
import {
  FIREBALL_FLY_ANIM,
  FIREBALL_FLY_TEXTURE,
  HOMING_ORB_FLY_ANIM,
  HOMING_ORB_FLY_TEXTURE,
} from "../../animation/FireballAnimDefs"

/** Depth for fireball sprites — renders above tilemap, below name tags. */
const FIREBALL_DEPTH = 10
/** Scale applied to the fireball sprite (256-px source → ~50-px sprite). */
const FIREBALL_SCALE = 0.2
/** Scale applied to Homing Orb: 60% of Fireball's projectile size. */
const HOMING_ORB_SCALE = FIREBALL_SCALE * 0.6

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

/** Per-Homing Orb render state: sprite + sim interpolation. */
interface HomingOrbRenderEntry {
  sprite: Phaser.GameObjects.Sprite
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
  private homingOrbEntries: Map<number, HomingOrbRenderEntry> = new Map()
  private readonly fireballBuffer = new RemoteInterpolationBuffer()
  private readonly homingOrbBuffer = new RemoteInterpolationBuffer()
  private simAccumulatorMs = 0
  private serverTimeOffsetMs = 0
  private remoteRenderDelayMs = resolveGameNetTiming().remoteRenderDelayMs

  /**
   * @param scene - The Arena scene instance.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /**
   * Applies server-provided net timing for Homing Orb interpolation.
   *
   * @param timing - Optional timing payload from `match_go` or `game_state_sync`.
   */
  applyNetTiming(timing?: Partial<GameNetTimingPayload> | null): void {
    this.remoteRenderDelayMs = resolveGameNetTiming(timing).remoteRenderDelayMs
  }

  /**
   * Updates the server-time-to-local-time offset from an authoritative payload.
   *
   * @param serverTimeMs - Server simulated or wall-clock time from a room message.
   */
  updateServerTimeOffset(serverTimeMs: number): void {
    const sample = serverTimeMs - Date.now()
    if (this.serverTimeOffsetMs === 0) {
      this.serverTimeOffsetMs = sample
    } else {
      this.serverTimeOffsetMs = this.serverTimeOffsetMs * 0.8 + sample * 0.2
    }
  }

  /**
   * Spawns a Homing Orb sprite.
   *
   * Idempotent for the same id: a second call destroys and respawns so the
   * sprite snaps to the latest authoritative position and heading.
   *
   * @param payload - HomingOrbLaunch event data from the server.
   */
  spawnHomingOrb(payload: HomingOrbLaunchPayload): void {
    if (this.homingOrbEntries.has(payload.id)) {
      this.destroyHomingOrb(payload.id)
    }

    ClientHomingOrb[payload.id] = {
      x: payload.x,
      y: payload.y,
      vx: payload.vx,
      vy: payload.vy,
      headingRad: payload.headingRad,
      ownerId: payload.ownerId,
      ...(payload.targetId !== undefined ? { targetId: payload.targetId } : {}),
    }

    const sprite = this.scene.add.sprite(
      payload.x,
      payload.y,
      HOMING_ORB_FLY_TEXTURE,
    )
    sprite.setScale(HOMING_ORB_SCALE)
    sprite.setDepth(FIREBALL_DEPTH)
    sprite.setRotation(payload.headingRad)

    if (this.scene.anims?.exists(HOMING_ORB_FLY_ANIM)) {
      sprite.play(HOMING_ORB_FLY_ANIM)
    }

    this.homingOrbEntries.set(payload.id, {
      sprite,
      simPrevX: payload.x,
      simPrevY: payload.y,
      simCurrX: payload.x,
      simCurrY: payload.y,
    })
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

    if (this.scene.anims?.exists(FIREBALL_FLY_ANIM)) {
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
  applyFullSyncFireballs(
    fireballs: readonly FireballSnapshot[],
    serverTimeMs = this.estimatedServerTimeMs(),
  ): void {
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
      const headingRad = Math.atan2(s.vy, s.vx)
      this.fireballBuffer.push(s.id, {
        serverTimeMs,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
        facingAngle: headingRad,
        moveFacingAngle: headingRad,
      })
    }
  }

  /**
   * Replaces all client Homing Orbs from a full `GameStateSync` snapshot.
   *
   * @param homingOrbs - Authoritative Homing Orb rows from the server.
   */
  applyFullSyncHomingOrbs(
    homingOrbs: readonly HomingOrbSnapshot[],
    serverTimeMs = this.estimatedServerTimeMs(),
  ): void {
    for (const id of [...this.homingOrbEntries.keys()]) {
      this.destroyHomingOrb(id)
    }
    for (const s of homingOrbs) {
      this.spawnHomingOrb(s)
      this.homingOrbBuffer.push(s.id, {
        serverTimeMs,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
        facingAngle: s.headingRad,
        moveFacingAngle: s.headingRad,
      })
    }
  }

  /**
   * Applies a batch position update for all active fireballs. Authoritative
   * positions are buffered by server time so delayed batches render smoothly
   * instead of snapping the sprite when the message is received.
   *
   * @param payload - FireballBatchUpdate event data from the server.
   */
  applyBatchUpdate(payload: FireballBatchUpdatePayload): void {
    if (payload.serverTimeMs !== undefined) {
      this.updateServerTimeOffset(payload.serverTimeMs)
    }
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
        const next = ClientFireball[delta.id]
        const headingRad = next ? Math.atan2(next.vy, next.vx) : 0
        this.fireballBuffer.push(delta.id, {
          serverTimeMs: payload.serverTimeMs ?? this.estimatedServerTimeMs(),
          x: delta.x,
          y: delta.y,
          vx: next?.vx ?? 0,
          vy: next?.vy ?? 0,
          facingAngle: headingRad,
          moveFacingAngle: headingRad,
        })
      }
    }
    for (const removedId of payload.removedIds) {
      this.destroyFireball(removedId)
    }
  }

  /**
   * Applies a batch movement update for all active Homing Orbs.
   *
   * @param payload - HomingOrbBatchUpdate event data from the server.
   */
  applyHomingOrbBatchUpdate(payload: HomingOrbBatchUpdatePayload): void {
    if (payload.serverTimeMs !== undefined) {
      this.updateServerTimeOffset(payload.serverTimeMs)
    }
    for (const delta of payload.deltas) {
      const orb = ClientHomingOrb[delta.id]
      if (orb) {
        if (delta.x !== undefined) orb.x = delta.x
        if (delta.y !== undefined) orb.y = delta.y
        if (delta.vx !== undefined) orb.vx = delta.vx
        if (delta.vy !== undefined) orb.vy = delta.vy
        if (delta.headingRad !== undefined) orb.headingRad = delta.headingRad
        if (delta.targetId === null) {
          delete orb.targetId
        } else if (delta.targetId !== undefined) {
          orb.targetId = delta.targetId
        }
      }
      const entry = this.homingOrbEntries.get(delta.id)
      const next = ClientHomingOrb[delta.id]
      if (
        entry &&
        next &&
        (delta.x !== undefined ||
          delta.y !== undefined ||
          delta.vx !== undefined ||
          delta.vy !== undefined ||
          delta.headingRad !== undefined)
      ) {
        entry.simCurrX = next.x
        entry.simCurrY = next.y
        this.homingOrbBuffer.push(delta.id, {
          serverTimeMs: payload.serverTimeMs ?? this.estimatedServerTimeMs(),
          x: next.x,
          y: next.y,
          vx: next.vx,
          vy: next.vy,
          facingAngle: next.headingRad,
          moveFacingAngle: next.headingRad,
        })
      }
    }
    for (const removedId of payload.removedIds) {
      this.destroyHomingOrb(removedId)
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
    this.fireballBuffer.remove(id)
    delete ClientFireball[id]
  }

  /**
   * Destroys the sprite for a Homing Orb that has impacted, expired, or been removed.
   *
   * @param id - Homing Orb entity id to remove.
   */
  destroyHomingOrb(id: number): void {
    const entry = this.homingOrbEntries.get(id)
    if (entry) {
      entry.sprite.destroy()
      this.homingOrbEntries.delete(id)
    }
    this.homingOrbBuffer.remove(id)
    delete ClientHomingOrb[id]
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
      if (this.fireballBuffer.has(id)) continue
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
    for (const [id, entry] of this.homingOrbEntries) {
      const orb = ClientHomingOrb[id]
      if (!orb) continue
      if (this.homingOrbBuffer.has(id)) continue
      entry.simPrevX = entry.simCurrX
      entry.simPrevY = entry.simCurrY
      entry.simCurrX += orb.vx * TICK_DT_SEC
      entry.simCurrY += orb.vy * TICK_DT_SEC
      orb.x = entry.simCurrX
      orb.y = entry.simCurrY
    }
  }

  private _renderStep(alpha: number): void {
    for (const [id, entry] of this.entries) {
      const buffered = this.fireballBuffer.sampleAt(
        id,
        this.estimatedServerTimeMs() - this.remoteRenderDelayMs,
      )
      const x = buffered?.x ??
        entry.simPrevX + (entry.simCurrX - entry.simPrevX) * alpha
      const y = buffered?.y ??
        entry.simPrevY + (entry.simCurrY - entry.simPrevY) * alpha
      entry.sprite.setPosition(x, y)
      if (buffered) {
        entry.sprite.setRotation(buffered.facingAngle)
      }
    }
    for (const [id, entry] of this.homingOrbEntries) {
      const buffered = this.homingOrbBuffer.sampleAt(
        id,
        this.estimatedServerTimeMs() - this.remoteRenderDelayMs,
      )
      const x = buffered?.x ??
        entry.simPrevX + (entry.simCurrX - entry.simPrevX) * alpha
      const y = buffered?.y ??
        entry.simPrevY + (entry.simCurrY - entry.simPrevY) * alpha
      entry.sprite.setPosition(x, y)
      const orb = ClientHomingOrb[id]
      if (buffered) {
        entry.sprite.setRotation(buffered.facingAngle)
      } else if (orb) {
        entry.sprite.setRotation(orb.headingRad)
      }
    }
  }

  /**
   * Estimates current server time from the latest authoritative projectile batch.
   *
   * @returns Local wall time adjusted by server offset.
   */
  private estimatedServerTimeMs(): number {
    return Date.now() + this.serverTimeOffsetMs
  }

  /** Destroys all active fireball sprites and emitters. Call on scene shutdown. */
  destroy(): void {
    for (const [id] of this.entries) {
      this.destroyFireball(id)
    }
    for (const [id] of this.homingOrbEntries) {
      this.destroyHomingOrb(id)
    }
    this.homingOrbBuffer.clear()
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
