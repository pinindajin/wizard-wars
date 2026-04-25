import Phaser from "phaser"

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

/** Depth for fireball sprites — renders above tilemap, below name tags. */
const FIREBALL_DEPTH = 10
/** Scale applied to the fireball sprite. */
const FIREBALL_SCALE = 0.5

/**
 * Maximum catch-up budget for the fixed-step sim accumulator. Mirrors
 * {@link PlayerRenderSystem}'s `MAX_SIM_LAG_MS` so a long tab-hitch
 * can't force the system to replay seconds of projectile motion in
 * one frame.
 */
const MAX_SIM_LAG_MS = 250

/** Per-fireball render state tracking prev/curr sim positions for interp. */
interface FireballRenderEntry {
  sprite: Phaser.GameObjects.Sprite
  simPrevX: number
  simPrevY: number
  simCurrX: number
  simCurrY: number
}

/**
 * Manages Phaser sprites for all active fireball projectiles.
 * Spawns sprites on FireballLaunch, advances their positions each sim
 * tick (`TICK_DT_SEC` fixed step, matching the server's integration
 * math), and interpolates between the last two committed sim states
 * for the render pass so motion stays smooth at any display refresh.
 * Destroys sprites on impact.
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
   * Spawns a fireball sprite for a newly launched projectile.
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

    const sprite = this.scene.add.sprite(payload.x, payload.y, "fireball")
    sprite.setScale(FIREBALL_SCALE)
    sprite.setDepth(FIREBALL_DEPTH)

    if (this.scene.anims.exists("fireball-fly")) {
      sprite.play("fireball-fly")
    }

    const angle = Math.atan2(payload.vy, payload.vx)
    sprite.setRotation(angle)

    this.entries.set(payload.id, {
      sprite,
      simPrevX: payload.x,
      simPrevY: payload.y,
      simCurrX: payload.x,
      simCurrY: payload.y,
    })
  }

  /**
   * Replaces all client fireballs from a full `GameStateSync` snapshot (reconnect / resync).
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
   * Destroys the sprite for a fireball that has impacted or expired.
   *
   * @param id - Fireball entity id to remove.
   */
  destroyFireball(id: number): void {
    const entry = this.entries.get(id)
    if (entry) {
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
   * Total elapsed motion still equals `velocity × elapsed` at any
   * display refresh rate; the render interpolation only smooths out
   * sub-tick visual stepping.
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

  /** Destroys all active fireball sprites. Call on scene shutdown. */
  destroy(): void {
    for (const [id] of this.entries) {
      this.destroyFireball(id)
    }
  }
}
