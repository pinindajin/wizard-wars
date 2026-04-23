import Phaser from "phaser"

import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import {
  INTERPOLATION_WINDOW_MS,
  PREDICTION_RECONCILE_ALPHA,
  PREDICTION_SNAP_THRESHOLD_PX,
  TELEPORT_THRESHOLD_PX,
} from "@/shared/balance-config/rendering"
import { BASE_MOVE_SPEED_PX_PER_SEC, DAMAGE_FLASH_MS } from "@/shared/balance-config/combat"
import type {
  GameStateSyncPayload,
  PlayerAnimState,
  PlayerDeathPayload,
  PlayerRespawnPayload,
} from "@/shared/types"
import { normalizedMoveFromWASD, type MoveIntent, worldStepFromIntent } from "@/shared/movementIntent"
import { ClientPosition, ClientPlayerState, ClientRenderPos } from "../components"
import { addEntity, removeEntity } from "../world"
import { getDirectionFromAngle, getAnimKey } from "../../animation/LadyWizardAnimDefs"

/** Oscillation frequency for invulnerability alpha pulse (Hz). */
const INVULN_PULSE_HZ = 4
/** Tag name used on HP bar game objects. */
const HP_BAR_TAG = "hp-bar"
/** Width of the HP bar in pixels. */
const HP_BAR_WIDTH = 48
/** Height of the HP bar in pixels. */
const HP_BAR_HEIGHT = 4
/** Y offset of name tag above sprite origin. */
const NAMETAG_OFFSET_Y = -72
/** Y offset of HP bar above sprite origin. */
const HP_BAR_OFFSET_Y = -58

/** Per-entity rendering state that lives outside the shared ECS records. */
interface PlayerRenderEntry {
  sprite: Phaser.GameObjects.Sprite
  nameTag: Phaser.GameObjects.Text
  hpBar: Phaser.GameObjects.Graphics
  /** Previous visual x position used for time-based interpolation. */
  prevX: number
  /** Previous visual y position used for time-based interpolation. */
  prevY: number
  /** Next authoritative x target for interpolation. */
  nextX: number
  /** Next authoritative y target for interpolation. */
  nextY: number
  /** Wall-clock ms when the current interpolation window started. */
  prevTime: number
  /** Wall-clock ms when the current interpolation window should end. */
  nextTime: number
  /** Accumulated time for invulnerability pulse (ms). */
  invulnTime: number
  /** Remaining damage flash time (ms). 0 = no flash active. */
  flashRemaining: number
  /** Tint to restore after damage flash. */
  heroTint: number
  /** Last known animState + direction key to avoid redundant anim calls. */
  lastAnimKey: string
}

/**
 * Manages Phaser sprites, name tags, and HP bars for all player entities.
 * Called each frame from Arena.update().
 */
export class PlayerRenderSystem {
  private scene: Phaser.Scene
  private group: Phaser.GameObjects.Group
  private entries: Map<number, PlayerRenderEntry> = new Map()
  private lastBatchTime = 0
  private measuredIntervalMs = INTERPOLATION_WINDOW_MS
  /** Set by Arena after connection is established. */
  localPlayerId: string | null = null

  /**
   * @param scene - The Arena scene instance.
   * @param group - Phaser group to register all player sprites into.
   */
  constructor(scene: Phaser.Scene, group: Phaser.GameObjects.Group) {
    this.scene = scene
    this.group = group
  }

  /**
   * Applies a full game state sync, creating sprites for all players.
   *
   * @param payload - Full game state snapshot from the server.
   */
  applyFullSync(payload: GameStateSyncPayload): void {
    const keep = new Set(payload.players.map((p) => p.id))
    for (const id of [...this.entries.keys()]) {
      if (!keep.has(id)) {
        this._despawnPlayer(id)
      }
    }
    for (const snap of payload.players) {
      if (!this.entries.has(snap.id)) {
        this._spawnPlayer(snap.id, snap.playerId, snap.username, snap.heroId, snap.x, snap.y)
      }
      ClientPosition[snap.id] = { x: snap.x, y: snap.y }
      ClientPlayerState[snap.id] = {
        playerId: snap.playerId,
        username: snap.username,
        heroId: snap.heroId,
        health: snap.health,
        maxHealth: snap.maxHealth,
        lives: snap.lives,
        animState: snap.animState,
        facingAngle: snap.facingAngle,
        invulnerable: snap.invulnerable,
      }
      this.onAuthoritativePosition(snap.id, snap.x, snap.y, "full_sync")
    }
  }

  /**
   * Records that a fresh authoritative player batch arrived so interpolation can
   * adapt to the observed network cadence.
   */
  markBatchReceived(): void {
    const now = Date.now()
    if (this.lastBatchTime > 0) {
      const gap = now - this.lastBatchTime
      this.measuredIntervalMs = Math.min(500, Math.max(INTERPOLATION_WINDOW_MS, this.measuredIntervalMs * 0.7 + gap * 0.3))
    }
    this.lastBatchTime = now
  }

  /**
   * Resets interpolation endpoints after any authoritative position write.
   * Call this after `ClientPosition` changes from network sync, full sync, respawn,
   * or any future teleport-style correction path.
   *
   * @param id - Entity id being updated.
   * @param x - Authoritative x position.
   * @param y - Authoritative y position.
   * @param reason - Why the authoritative position changed.
   */
  onAuthoritativePosition(id: number, x: number, y: number, reason: "spawn" | "full_sync" | "batch_update" | "respawn"): void {
    const now = Date.now()
    const entry = this.entries.get(id)
    const renderPos = ClientRenderPos[id] ?? { x, y }
    ClientRenderPos[id] = renderPos

    if (!entry) {
      renderPos.x = x
      renderPos.y = y
      return
    }

    if (reason === "batch_update") {
      entry.prevX = renderPos.x
      entry.prevY = renderPos.y
      entry.nextX = x
      entry.nextY = y
      entry.prevTime = now
      entry.nextTime = now + this.measuredIntervalMs
      return
    }

    entry.prevX = x
    entry.prevY = y
    entry.nextX = x
    entry.nextY = y
    entry.prevTime = now
    entry.nextTime = now
    renderPos.x = x
    renderPos.y = y
    entry.sprite.setPosition(x, y)
  }

  /**
   * Spawns a new player sprite with name tag and HP bar.
   *
   * @param id - Entity id.
   * @param playerId - Server player id (userId / sessionId).
   * @param username - Display name.
   * @param heroId - Hero configuration key.
   * @param x - Initial world x.
   * @param y - Initial world y.
   */
  private _spawnPlayer(
    id: number,
    playerId: string,
    username: string,
    heroId: string,
    x: number,
    y: number,
  ): void {
    addEntity(id)

    const heroTint = HERO_CONFIGS[heroId]?.tint ?? 0xffffff
    const isLocal = playerId === this.localPlayerId

    const sprite = this.scene.add.sprite(x, y, "lady-wizard")
    sprite.setOrigin(0.5, 1.0)
    sprite.setTint(heroTint)
    sprite.setDepth(y)
    this.group.add(sprite)

    const nameTag = this.scene.add
      .text(x, y + NAMETAG_OFFSET_Y, username, {
        fontSize: "11px",
        fontFamily: "monospace",
        color: isLocal ? "#ffff00" : "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(y + 1)

    const hpBar = this.scene.add.graphics()
    hpBar.setData(HP_BAR_TAG, true)
    hpBar.setDepth(y + 1)

    this.entries.set(id, {
      sprite,
      nameTag,
      hpBar,
      prevX: x,
      prevY: y,
      nextX: x,
      nextY: y,
      prevTime: 0,
      nextTime: 0,
      invulnTime: 0,
      flashRemaining: 0,
      heroTint,
      lastAnimKey: "",
    })
    ClientRenderPos[id] = { x, y }
    this.onAuthoritativePosition(id, x, y, "spawn")
  }

  /**
   * Removes a player sprite and its UI elements.
   *
   * @param id - Entity id to remove.
   */
  private _despawnPlayer(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.sprite.destroy()
    entry.nameTag.destroy()
    entry.hpBar.destroy()
    this.entries.delete(id)
    removeEntity(id)
    delete ClientPosition[id]
    delete ClientRenderPos[id]
    delete ClientPlayerState[id]
  }

  /**
   * Triggers a red damage flash on a player sprite.
   *
   * @param id - Entity id of the player that was hit.
   */
  triggerDamageFlash(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.flashRemaining = DAMAGE_FLASH_MS
    entry.sprite.setTint(0xff0000)
  }

  /**
   * Handles a PlayerDeath event: hides name tag + HP bar, plays death state.
   *
   * @param payload - Death event data from the server.
   */
  onPlayerDeath(payload: PlayerDeathPayload): void {
    for (const [, state] of Object.entries(ClientPlayerState)) {
      if (state.playerId === payload.playerId) {
        state.animState = "dying"
        break
      }
    }
  }

  /**
   * Handles a PlayerRespawn event: snaps sprite to spawn position.
   *
   * @param payload - Respawn event data from the server.
   */
  onPlayerRespawn(payload: PlayerRespawnPayload): void {
    for (const [idStr, state] of Object.entries(ClientPlayerState)) {
      if (state.playerId === payload.playerId) {
        const id = Number(idStr)
        ClientPosition[id] = { x: payload.spawnX, y: payload.spawnY }
        state.animState = "idle"
        this.onAuthoritativePosition(id, payload.spawnX, payload.spawnY, "respawn")
        break
      }
    }
  }

  /**
   * Main per-frame update. Interpolates positions, updates animations, damage flashes,
   * invulnerability pulse, name tags, and HP bars.
   *
   * @param delta - Frame delta time in ms.
   * @param localMoveIntent - Local player's current movement intent for prediction.
   */
  update(delta: number, localMoveIntent: MoveIntent): void {
    const now = Date.now()

    for (const [id, entry] of this.entries) {
      const state = ClientPlayerState[id]
      const authPos = ClientPosition[id]
      const renderPos = ClientRenderPos[id]

      if (!state || !authPos || !renderPos) continue

      const interpolatedPos = this._getInterpolatedPosition(entry, now)
      const isLocal = state.playerId === this.localPlayerId

      if (isLocal) {
        const predictedPos = this._getPredictedLocalPosition(renderPos, interpolatedPos, state.animState, localMoveIntent, delta)
        renderPos.x = predictedPos.x
        renderPos.y = predictedPos.y
      } else {
        renderPos.x = interpolatedPos.x
        renderPos.y = interpolatedPos.y
      }

      entry.sprite.setPosition(renderPos.x, renderPos.y)

      // --- Y-sort depth ---
      entry.sprite.setDepth(renderPos.y)

      // --- Animation ---
      const isDying = state.animState === "dying" || state.animState === "dead"
      const direction = getDirectionFromAngle(state.facingAngle)
      const animKey = getAnimKey(state.animState, direction)
      if (animKey !== entry.lastAnimKey) {
        entry.sprite.play(animKey, true)
        entry.lastAnimKey = animKey
      }

      // --- Damage flash ---
      if (entry.flashRemaining > 0) {
        entry.flashRemaining -= delta
        if (entry.flashRemaining <= 0) {
          entry.flashRemaining = 0
          entry.sprite.setTint(entry.heroTint)
        }
      }

      // --- Invulnerability alpha pulse ---
      if (state.invulnerable) {
        entry.invulnTime += delta
        const pulse = Math.sin((entry.invulnTime / 1000) * INVULN_PULSE_HZ * Math.PI * 2)
        const alpha = 0.625 + pulse * 0.0625
        entry.sprite.setAlpha(alpha)
      } else {
        entry.sprite.setAlpha(1)
        entry.invulnTime = 0
      }

      // --- Name tag + HP bar ---
      const hideUi = isDying
      entry.nameTag.setVisible(!hideUi)
      entry.hpBar.setVisible(!hideUi)

      if (!hideUi) {
        entry.nameTag.setPosition(renderPos.x, renderPos.y + NAMETAG_OFFSET_Y)
        entry.nameTag.setDepth(renderPos.y + 1)

        const hpFraction = state.maxHealth > 0 ? state.health / state.maxHealth : 0
        this._drawHpBar(entry.hpBar, renderPos.x, renderPos.y + HP_BAR_OFFSET_Y, hpFraction)
        entry.hpBar.setDepth(renderPos.y + 1)
      }
    }
  }

  /**
   * Redraws the HP bar graphics for a player.
   *
   * @param gfx - Graphics object to redraw.
   * @param cx - World x center.
   * @param y - World y position.
   * @param fraction - HP fraction 0–1.
   */
  private _drawHpBar(gfx: Phaser.GameObjects.Graphics, cx: number, y: number, fraction: number): void {
    gfx.clear()
    // Background
    gfx.fillStyle(0x000000, 0.7)
    gfx.fillRect(cx - HP_BAR_WIDTH / 2, y, HP_BAR_WIDTH, HP_BAR_HEIGHT)
    // Fill — gradient green → yellow → red
    const fillColor = fraction > 0.5
      ? Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(0xffff00),
          Phaser.Display.Color.ValueToColor(0x00ff44),
          100,
          Math.round((fraction - 0.5) * 200),
        )
      : Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(0xff2200),
          Phaser.Display.Color.ValueToColor(0xffff00),
          100,
          Math.round(fraction * 200),
        )
    const color = Phaser.Display.Color.GetColor(fillColor.r, fillColor.g, fillColor.b)
    gfx.fillStyle(color, 1)
    gfx.fillRect(cx - HP_BAR_WIDTH / 2, y, Math.round(HP_BAR_WIDTH * fraction), HP_BAR_HEIGHT)
  }

  /**
   * Computes the current time-based interpolated position for one player.
   *
   * @param entry - Per-player render entry.
   * @param now - Current wall-clock timestamp in ms.
   * @returns Interpolated world position for this frame.
   */
  private _getInterpolatedPosition(entry: PlayerRenderEntry, now: number): { x: number; y: number } {
    const dx = entry.nextX - entry.prevX
    const dy = entry.nextY - entry.prevY
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist > TELEPORT_THRESHOLD_PX) {
      return { x: entry.nextX, y: entry.nextY }
    }

    const dt = entry.nextTime - entry.prevTime || 1
    const alpha = Math.min(1, Math.max(0, (now - entry.prevTime) / dt))
    return {
      x: entry.prevX + dx * alpha,
      y: entry.prevY + dy * alpha,
    }
  }

  /**
   * Applies local-only client prediction and gently reconciles back to the
   * authoritative interpolation path.
   *
   * @param currentRenderPos - Current rendered position from the previous frame.
   * @param interpolatedPos - Current authoritative interpolation target.
   * @param animState - Server-reported animation state for prediction gating.
   * @param moveIntent - Current local movement intent.
   * @param delta - Frame delta time in ms.
   * @returns Predicted and reconciled render position for this frame.
   */
  private _getPredictedLocalPosition(
    currentRenderPos: { x: number; y: number },
    interpolatedPos: { x: number; y: number },
    animState: PlayerAnimState,
    moveIntent: MoveIntent,
    delta: number,
  ): { x: number; y: number } {
    if (!this._canPredictMovement(animState, moveIntent)) {
      return interpolatedPos
    }

    const { dx, dy } = normalizedMoveFromWASD(moveIntent)
    const step = worldStepFromIntent(dx, dy, BASE_MOVE_SPEED_PX_PER_SEC, delta / 1000)
    const predictedX = currentRenderPos.x + step.x
    const predictedY = currentRenderPos.y + step.y
    const errorX = interpolatedPos.x - predictedX
    const errorY = interpolatedPos.y - predictedY
    const errorDist = Math.sqrt(errorX * errorX + errorY * errorY)

    if (errorDist > PREDICTION_SNAP_THRESHOLD_PX) {
      return interpolatedPos
    }

    return {
      x: predictedX + errorX * PREDICTION_RECONCILE_ALPHA,
      y: predictedY + errorY * PREDICTION_RECONCILE_ALPHA,
    }
  }

  /**
   * Returns whether local client prediction should run for this frame.
   *
   * @param animState - Current authoritative animation state.
   * @param moveIntent - Current local movement intent.
   * @returns True when local prediction is safe and useful.
   */
  private _canPredictMovement(animState: PlayerAnimState, moveIntent: MoveIntent): boolean {
    const { dx, dy } = normalizedMoveFromWASD(moveIntent)
    if (dx === 0 && dy === 0) {
      return false
    }

    return animState !== "dying" &&
      animState !== "dead" &&
      animState !== "light_cast" &&
      animState !== "heavy_cast" &&
      animState !== "axe_swing"
  }

  /**
   * Removes all player sprites and entries. Call on scene shutdown.
   */
  destroy(): void {
    for (const [id] of this.entries) {
      this._despawnPlayer(id)
    }
  }
}
