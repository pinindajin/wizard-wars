import Phaser from "phaser"

import {
  TELEGRAPH_DANGER_FILL_ALPHA,
  TELEGRAPH_DANGER_FILL_COLOR,
  TELEGRAPH_WINDUP_FILL_ALPHA,
  TELEGRAPH_WINDUP_FILL_COLOR,
  TILEMAP_DEPTH,
} from "@/shared/balance-config"
import type {
  CombatTelegraphEndPayload,
  CombatTelegraphStartPayload,
} from "@/shared/types"
import { ClientPlayerState, ClientRenderPos } from "../components"

/** Depth for floor telegraphs: above tilemap, below player sprites/VFX. */
const TELEGRAPH_DEPTH = TILEMAP_DEPTH + 100

type TelegraphEntry = {
  readonly gfx: Phaser.GameObjects.Graphics
  readonly payload: CombatTelegraphStartPayload
}

/**
 * Renders server-seeded, client-side ground telegraphs for combat hurtboxes.
 */
export class CombatTelegraphRenderSystem {
  private readonly scene: Phaser.Scene
  private readonly telegraphs = new Map<string, TelegraphEntry>()

  /**
   * @param scene - Arena scene instance.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /**
   * Replaces active telegraphs from a full server snapshot.
   *
   * @param payloads - Active telegraphs from GameStateSync.
   */
  applyFullSync(payloads: readonly CombatTelegraphStartPayload[]): void {
    this.destroy()
    for (const payload of payloads) {
      this.start(payload)
    }
  }

  /**
   * Starts or replaces a telegraph.
   *
   * @param payload - Server-seeded telegraph metadata.
   */
  start(payload: CombatTelegraphStartPayload): void {
    this.end({ id: payload.id, reason: "expired" })
    const gfx = this.scene.add.graphics()
    gfx.setDepth(TELEGRAPH_DEPTH)
    this.telegraphs.set(payload.id, { gfx, payload })
  }

  /**
   * Removes one telegraph if it exists.
   *
   * @param payload - End payload from server.
   */
  end(payload: CombatTelegraphEndPayload): void {
    const entry = this.telegraphs.get(payload.id)
    if (!entry) return
    entry.gfx.destroy()
    this.telegraphs.delete(payload.id)
  }

  /**
   * Redraws active telegraphs and removes expired ones.
   *
   * @param serverTimeMs - Estimated current server time.
   */
  update(serverTimeMs: number): void {
    for (const [id, entry] of this.telegraphs) {
      if (serverTimeMs >= entry.payload.endsAtServerTimeMs) {
        entry.gfx.destroy()
        this.telegraphs.delete(id)
        continue
      }
      const anchor = this._anchorPosition(entry.payload.casterId)
      if (!anchor) {
        entry.gfx.clear()
        continue
      }
      this._draw(entry.gfx, entry.payload, anchor, serverTimeMs)
    }
  }

  /**
   * Draws one telegraph at its current anchor.
   */
  private _draw(
    gfx: Phaser.GameObjects.Graphics,
    payload: CombatTelegraphStartPayload,
    anchor: { x: number; y: number },
    serverTimeMs: number,
  ): void {
    const dangerous =
      serverTimeMs >= payload.dangerStartsAtServerTimeMs &&
      serverTimeMs < payload.dangerEndsAtServerTimeMs
    const fill = dangerous ? TELEGRAPH_DANGER_FILL_COLOR : TELEGRAPH_WINDUP_FILL_COLOR
    const fillAlpha = dangerous ? TELEGRAPH_DANGER_FILL_ALPHA : TELEGRAPH_WINDUP_FILL_ALPHA

    gfx.clear()
    gfx.fillStyle(fill, fillAlpha)

    if (payload.shape.type === "cone") {
      this._drawCone(gfx, anchor.x, anchor.y, payload.directionRad, payload.shape.radiusPx, payload.shape.arcDeg)
      return
    }

    const endX = anchor.x + Math.cos(payload.directionRad) * payload.shape.lengthPx
    const endY = anchor.y + Math.sin(payload.directionRad) * payload.shape.lengthPx
    this._drawCapsule(gfx, anchor.x, anchor.y, endX, endY, payload.shape.radiusPx)
  }

  /**
   * Draws a cone telegraph.
   */
  private _drawCone(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    directionRad: number,
    radiusPx: number,
    arcDeg: number,
  ): void {
    const halfArc = (arcDeg * Math.PI) / 360
    gfx.beginPath()
    gfx.moveTo(x, y)
    gfx.arc(x, y, radiusPx, directionRad - halfArc, directionRad + halfArc, false)
    gfx.closePath()
    gfx.fillPath()
  }

  /**
   * Draws a capsule telegraph using circles plus connecting quad.
   */
  private _drawCapsule(
    gfx: Phaser.GameObjects.Graphics,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    radiusPx: number,
  ): void {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) {
      gfx.fillCircle(ax, ay, radiusPx)
      return
    }

    const nx = -dy / len
    const ny = dx / len
    gfx.beginPath()
    gfx.moveTo(ax + nx * radiusPx, ay + ny * radiusPx)
    gfx.lineTo(bx + nx * radiusPx, by + ny * radiusPx)
    gfx.lineTo(bx - nx * radiusPx, by - ny * radiusPx)
    gfx.lineTo(ax - nx * radiusPx, ay - ny * radiusPx)
    gfx.closePath()
    gfx.fillPath()
    gfx.fillCircle(ax, ay, radiusPx)
    gfx.fillCircle(bx, by, radiusPx)
  }

  /**
   * Looks up the rendered foot position for a player id.
   */
  private _anchorPosition(playerId: string): { x: number; y: number } | null {
    for (const [idStr, state] of Object.entries(ClientPlayerState)) {
      if (state.playerId !== playerId) continue
      const pos = ClientRenderPos[Number(idStr)]
      if (pos) return pos
    }
    return null
  }

  /** Destroys all telegraph graphics. */
  destroy(): void {
    for (const entry of this.telegraphs.values()) {
      entry.gfx.destroy()
    }
    this.telegraphs.clear()
  }
}
