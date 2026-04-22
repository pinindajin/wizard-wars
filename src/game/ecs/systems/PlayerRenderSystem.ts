import Phaser from "phaser"

import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import { INTERP_EMA_ALPHA, TELEPORT_THRESHOLD_PX } from "@/shared/balance-config/rendering"
import { DAMAGE_FLASH_MS } from "@/shared/balance-config/combat"
import type { GameStateSyncPayload, PlayerDeathPayload, PlayerRespawnPayload } from "@/shared/types"
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
    for (const snap of payload.players) {
      if (!this.entries.has(snap.id)) {
        this._spawnPlayer(snap.id, snap.playerId, snap.username, snap.heroId, snap.x, snap.y)
      }
      ClientPosition[snap.id] = { x: snap.x, y: snap.y }
      ClientRenderPos[snap.id] = { x: snap.x, y: snap.y }
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
    }
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
      invulnTime: 0,
      flashRemaining: 0,
      heroTint,
      lastAnimKey: "",
    })
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
        ClientRenderPos[id] = { x: payload.spawnX, y: payload.spawnY }
        state.animState = "idle"
        break
      }
    }
  }

  /**
   * Main per-frame update. Interpolates positions, updates animations, damage flashes,
   * invulnerability pulse, name tags, and HP bars.
   *
   * @param delta - Frame delta time in ms.
   */
  update(delta: number): void {
    for (const [id, entry] of this.entries) {
      const state = ClientPlayerState[id]
      const authPos = ClientPosition[id]
      const renderPos = ClientRenderPos[id]

      if (!state || !authPos || !renderPos) continue

      // --- Position interpolation ---
      const dx = authPos.x - renderPos.x
      const dy = authPos.y - renderPos.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > TELEPORT_THRESHOLD_PX) {
        renderPos.x = authPos.x
        renderPos.y = authPos.y
      } else {
        renderPos.x += dx * INTERP_EMA_ALPHA
        renderPos.y += dy * INTERP_EMA_ALPHA
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
   * Removes all player sprites and entries. Call on scene shutdown.
   */
  destroy(): void {
    for (const [id] of this.entries) {
      this._despawnPlayer(id)
    }
  }
}
