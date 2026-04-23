import Phaser from "phaser"

import type {
  FireballLaunchPayload,
  FireballBatchUpdatePayload,
  FireballSnapshot,
} from "@/shared/types"
import { ClientFireball } from "../components"

/** Depth for fireball sprites — renders above tilemap, below name tags. */
const FIREBALL_DEPTH = 10
/** Scale applied to the fireball sprite. */
const FIREBALL_SCALE = 0.5

/**
 * Manages Phaser sprites for all active fireball projectiles.
 * Spawns sprites on FireballLaunch, moves them each frame, and destroys them on impact.
 */
export class ProjectileRenderSystem {
  private scene: Phaser.Scene
  private sprites: Map<number, Phaser.GameObjects.Sprite> = new Map()

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

    const sprite = this.scene.add.sprite(payload.x, payload.y, "fireball")
    sprite.setScale(FIREBALL_SCALE)
    sprite.setDepth(FIREBALL_DEPTH)

    if (this.scene.anims.exists("fireball-fly")) {
      sprite.play("fireball-fly")
    }

    const angle = Math.atan2(payload.vy, payload.vx)
    sprite.setRotation(angle)

    this.sprites.set(payload.id, sprite)
  }

  /**
   * Replaces all client fireballs from a full `GameStateSync` snapshot (reconnect / resync).
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
   * Destroys the sprite for a fireball that has impacted or expired.
   *
   * @param id - Fireball entity id to remove.
   */
  destroyFireball(id: number): void {
    const sprite = this.sprites.get(id)
    if (sprite) {
      sprite.destroy()
      this.sprites.delete(id)
    }
    delete ClientFireball[id]
  }

  /**
   * Per-frame update: client-side prediction of fireball positions between server ticks.
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

  /** Destroys all active fireball sprites. Call on scene shutdown. */
  destroy(): void {
    for (const [id] of this.sprites) {
      this.destroyFireball(id)
    }
  }
}
