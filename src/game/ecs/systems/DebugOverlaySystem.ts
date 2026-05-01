import type Phaser from "phaser"

import { PLAYER_WORLD_COLLISION_FOOTPRINT } from "@/shared/balance-config/combat"
import { characterHitboxForCenter } from "@/shared/collision/characterHitbox"
import { ClientPlayerState, ClientRenderPos } from "../components"
import { clientEntities } from "../world"
import { PlayerRenderSystem } from "./PlayerRenderSystem"

const DEBUG_OVERLAY_DEPTH = 50_000
const FIREBALL_PREVIEW_SPAWN_OFFSET_PX = 25
const FIREBALL_PREVIEW_LENGTH_PX = 200

const HITBOX_COLOR = 0xff3366
const COLLISION_COLOR = 0x33ddff
const CENTER_COLOR = 0xffff33
const FIREBALL_COLOR = 0xffaa33

export type FireballPreviewLine = {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/**
 * Computes the debug preview segment for a pending fireball.
 *
 * @param x - Caster render anchor x.
 * @param y - Caster render anchor y.
 * @param facingAngle - Captured fireball travel angle in radians.
 * @returns The preview line from spawn point to 200 px along travel direction.
 */
export function fireballPreviewLineFor(
  x: number,
  y: number,
  facingAngle: number,
): FireballPreviewLine {
  const dx = Math.cos(facingAngle)
  const dy = Math.sin(facingAngle)
  const x1 = x + dx * FIREBALL_PREVIEW_SPAWN_OFFSET_PX
  const y1 = y + dy * FIREBALL_PREVIEW_SPAWN_OFFSET_PX
  return {
    x1,
    y1,
    x2: x1 + dx * FIREBALL_PREVIEW_LENGTH_PX,
    y2: y1 + dy * FIREBALL_PREVIEW_LENGTH_PX,
  }
}

/**
 * Draws local-only arena debug overlays using one reusable Graphics object.
 */
export class DebugOverlaySystem {
  private readonly graphics: Phaser.GameObjects.Graphics
  private enabled = false

  /**
   * @param scene - Active Arena scene.
   */
  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
    this.graphics.setDepth(DEBUG_OVERLAY_DEPTH)
    this.graphics.setVisible(false)
    scene.events.once("shutdown", () => this.destroy())
  }

  /**
   * Enables or disables overlay drawing.
   *
   * @param enabled - Whether debug geometry should be visible.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.graphics.clear()
    this.graphics.setVisible(enabled)
  }

  /**
   * Redraws all debug geometry for the latest rendered player positions.
   */
  update(): void {
    if (!this.enabled) return

    const g = this.graphics
    g.clear()
    g.setVisible(true)

    for (const id of clientEntities) {
      const renderPos = ClientRenderPos[id]
      const state = ClientPlayerState[id]
      if (!renderPos || !state || state.animState === "dying" || state.animState === "dead") {
        continue
      }

      this.drawPlayerOverlays(g, renderPos.x, renderPos.y)

      if (PlayerRenderSystem.shouldShowFireballChannel(state)) {
        const line = fireballPreviewLineFor(
          renderPos.x,
          renderPos.y,
          state.facingAngle,
        )
        this.drawFireballPreview(g, line)
      }
    }
  }

  /**
   * Destroys the owned Graphics object.
   */
  destroy(): void {
    this.graphics.destroy()
  }

  private drawPlayerOverlays(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
  ): void {
    const hitbox = characterHitboxForCenter(x, y)
    g.lineStyle(2, HITBOX_COLOR, 0.9)
    g.strokeRect(hitbox.x, hitbox.y, hitbox.width, hitbox.height)

    const footprint = PLAYER_WORLD_COLLISION_FOOTPRINT
    g.lineStyle(2, COLLISION_COLOR, 0.85)
    g.strokeEllipse(
      x,
      y + footprint.offsetY,
      footprint.radiusX * 2,
      footprint.radiusY * 2,
    )

    g.lineStyle(2, CENTER_COLOR, 1)
    g.strokeCircle(x, y, 4)
    g.lineBetween(x - 7, y, x + 7, y)
    g.lineBetween(x, y - 7, x, y + 7)
  }

  private drawFireballPreview(
    g: Phaser.GameObjects.Graphics,
    line: FireballPreviewLine,
  ): void {
    g.lineStyle(3, FIREBALL_COLOR, 0.95)
    g.lineBetween(line.x1, line.y1, line.x2, line.y2)
    g.fillStyle(FIREBALL_COLOR, 0.95)
    g.fillCircle(line.x1, line.y1, 4)
  }
}
