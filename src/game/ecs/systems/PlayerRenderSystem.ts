import Phaser from "phaser"

import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import { ABILITY_CONFIGS } from "@/shared/balance-config/abilities"
import {
  REMOTE_RENDER_DELAY_MS,
  REPLAY_SMOOTHING_MS,
  TELEPORT_THRESHOLD_PX,
} from "@/shared/balance-config/rendering"
import { BASE_MOVE_SPEED_PX_PER_SEC, DAMAGE_FLASH_MS } from "@/shared/balance-config/combat"
import type {
  GameStateSyncPayload,
  PlayerAnimState,
  PlayerDeathPayload,
  PlayerRespawnPayload,
} from "@/shared/types"
import {
  normalizedMoveFromWASD,
  type MoveIntent,
  worldStepFromIntent,
} from "@/shared/movementIntent"
import { ClientPosition, ClientPlayerState, ClientRenderPos } from "../components"
import { addEntity, removeEntity } from "../world"
import { animUsesMouseAim } from "@/shared/playerAnimAim"
import { getDirectionFromAngle, getAnimKey } from "../../animation/LadyWizardAnimDefs"
import {
  reconcileLocal,
  type LocalAckState,
  type LocalReplayContext,
} from "./ReconciliationSystem"
import { LocalInputHistory } from "../../network/LocalInputHistory"
import { RemoteInterpolationBuffer } from "./RemoteInterpolationBuffer"

/** Oscillation frequency for invulnerability alpha pulse (Hz). */
const INVULN_PULSE_HZ = 4
/** Tag name used on HP bar game objects. */
const HP_BAR_TAG = "hp-bar"
/** Width of the HP bar in pixels. */
const HP_BAR_WIDTH = 48
/** Height of the HP bar in pixels. */
const HP_BAR_HEIGHT = 4

/**
 * Lady-wizard frame height in pixels (must match `frameSize` in
 * `public/assets/sprites/heroes/lady-wizard/sheets/atlas.json`).
 */
export const LADY_WIZARD_FRAME_HEIGHT_PX = 124

/** Pixels between nametag bottom (`setOrigin(0.5, 1)`) and HP bar top (`_drawHpBar` y). */
export const NAME_TO_HP_BAR_GAP_PX = 3

/** Pixels of vertical gap from sprite texture top to the bottom edge of the HP bar. */
export const HUD_CLEARANCE_ABOVE_SPRITE_TOP_PX = 10

/**
 * Nametag + HP Y positions for a given foot anchor (`y` = bottom of 124px frame).
 * HP bar top is chosen so the bar’s bottom is `HUD_CLEARANCE_ABOVE_SPRITE_TOP_PX` above the
 * texture top; nametag sits `NAME_TO_HP_BAR_GAP_PX` above the HP bar top.
 */
export function computeHeroHudYOffsets(footY: number): {
  nameTagBottomY: number
  hpBarTopY: number
} {
  const spriteTopY = footY - LADY_WIZARD_FRAME_HEIGHT_PX
  const hpBarTopY = spriteTopY - HUD_CLEARANCE_ABOVE_SPRITE_TOP_PX - HP_BAR_HEIGHT
  const nameTagBottomY = hpBarTopY - NAME_TO_HP_BAR_GAP_PX
  return { nameTagBottomY, hpBarTopY }
}

/** Width of the hero identity foot ellipse (px). */
const FOOT_MARKER_W = 32
/** Height of the hero identity foot ellipse (px). */
const FOOT_MARKER_H = 16
/**
 * Y-sort offset so the foot marker draws behind the sprite (lower depth than the sprite).
 * If fractional depth misbehaves in a build, try `1` instead of `0.1`.
 */
const FOOT_MARKER_DEPTH_EPS = 0.1
/**
 * Offset from foot anchor (`renderPos.y`, texture bottom) to the ellipse center.
 * The ellipse is centered in the **bottom fifth** of the 124px frame: band from
 * `y - 0.2*H` to `y` — midline at `y - 0.1*H` (upward in screen Y).
 */
const FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT = -Math.round(LADY_WIZARD_FRAME_HEIGHT_PX * 0.1)

/** Per-entity rendering state that lives outside the shared ECS records. */
interface PlayerRenderEntry {
  sprite: Phaser.GameObjects.Sprite
  /** Colored ellipse under the feet; scene-owned (not in `playerGroup`). */
  footMarker: Phaser.GameObjects.Ellipse
  nameTag: Phaser.GameObjects.Text
  hpBar: Phaser.GameObjects.Graphics
  /** Accumulated time for invulnerability pulse (ms). */
  invulnTime: number
  /** Remaining damage flash time (ms). 0 = no flash active. */
  flashRemaining: number
  /** Last known animState + direction key to avoid redundant anim calls. */
  lastAnimKey: string
  /**
   * Remaining ms in the current "smooth replay correction" window. When > 0
   * the local player's rendered position is blended linearly from its value
   * at the start of the window (`smoothFromX/Y`) toward `smoothTargetX/Y`.
   */
  smoothRemainingMs: number
  smoothFromX: number
  smoothFromY: number
  smoothTargetX: number
  smoothTargetY: number
}

/**
 * Manages Phaser sprites, hero foot identity ellipses, name tags, and HP bars for all player entities.
 *
 * The local player uses prediction (extrapolate from the latest authoritative
 * state using held WASD + speed multipliers) plus rewind-and-replay
 * reconciliation via {@link reconcileLocal}. Remote players use an
 * interpolation-buffer render path sampled at `now - REMOTE_RENDER_DELAY_MS`
 * with velocity-aware extrapolation when the buffer underflows.
 */
export class PlayerRenderSystem {
  private scene: Phaser.Scene
  private group: Phaser.GameObjects.Group
  private entries: Map<number, PlayerRenderEntry> = new Map()

  /** Set by Arena after connection is established. */
  localPlayerId: string | null = null

  /** Local player's pending inputs (used for rewind-and-replay). */
  readonly localInputHistory: LocalInputHistory = new LocalInputHistory()

  /** Per-remote snapshot buffer used by the remote render path. */
  readonly remoteBuffer: RemoteInterpolationBuffer = new RemoteInterpolationBuffer()

  /**
   * Offset from server clock to local clock, roughly `serverTime - Date.now()`.
   * Updated on every authoritative batch so remote interpolation can map
   * `now - REMOTE_RENDER_DELAY_MS` into server-time for sampling.
   */
  private serverTimeOffsetMs = 0

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
    this.updateServerTimeOffset(payload.serverTimeMs)
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
        castingAbilityId: snap.castingAbilityId,
        facingAngle: snap.facingAngle,
        moveFacingAngle: snap.moveFacingAngle,
        invulnerable: snap.invulnerable,
      }
      this.onAuthoritativePosition(snap.id, snap.x, snap.y, "full_sync")

      // Seed the remote buffer for non-local players from the full sync.
      if (snap.playerId !== this.localPlayerId) {
        this.remoteBuffer.push(snap.id, {
          serverTimeMs: payload.serverTimeMs,
          x: snap.x,
          y: snap.y,
          vx: snap.vx,
          vy: snap.vy,
          facingAngle: snap.facingAngle,
          moveFacingAngle: snap.moveFacingAngle,
        })
      }
    }
  }

  /**
   * Records that a fresh authoritative player batch arrived. Kept as a no-op
   * hook for backwards compatibility with existing call sites; the actual
   * interpolation-cadence math now lives in {@link RemoteInterpolationBuffer}.
   */
  markBatchReceived(): void {
    // Intentional no-op — left for call-site compatibility.
  }

  /**
   * Updates the server-time-to-local-time offset from an authoritative
   * `serverTimeMs`. Uses an EMA to smooth out clock jitter.
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
   * Resets per-entity render bookkeeping after any authoritative position
   * write. For the local player this seeds `ClientRenderPos`; for remote
   * players the actual position is sampled each frame from the
   * interpolation buffer.
   *
   * @param id - Entity id being updated.
   * @param x - Authoritative x position.
   * @param y - Authoritative y position.
   * @param reason - Why the authoritative position changed.
   */
  onAuthoritativePosition(
    id: number,
    x: number,
    y: number,
    reason: "spawn" | "full_sync" | "batch_update" | "respawn",
  ): void {
    const entry = this.entries.get(id)
    const renderPos = ClientRenderPos[id] ?? { x, y }
    ClientRenderPos[id] = renderPos

    if (!entry) {
      renderPos.x = x
      renderPos.y = y
      return
    }

    // Non-batch reasons always snap visually (spawn / respawn / full sync).
    if (reason !== "batch_update") {
      renderPos.x = x
      renderPos.y = y
      entry.sprite.setPosition(x, y)
      const footY = y + FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT
      entry.footMarker.setPosition(x, footY)
      entry.footMarker.setDepth(y - FOOT_MARKER_DEPTH_EPS)
      entry.smoothRemainingMs = 0
    }
  }

  /**
   * Pushes an authoritative snapshot for a remote player into the
   * interpolation buffer. Called by the network sync layer after every batch.
   */
  onRemoteSnapshot(
    id: number,
    sample: {
      serverTimeMs: number
      x: number
      y: number
      vx: number
      vy: number
      facingAngle: number
      moveFacingAngle: number
    },
  ): void {
    this.remoteBuffer.push(id, sample)
  }

  /**
   * Applies an authoritative ACK for the local player, running
   * rewind-and-replay reconciliation and arming a smooth / snap correction
   * as needed.
   */
  onLocalAck(id: number, ack: LocalAckState): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const state = ClientPlayerState[id]
    const renderPos = ClientRenderPos[id]
    if (!state || !renderPos) return

    const ctx: LocalReplayContext = {
      isSwinging: state.animState === "axe_swing",
      hasSwiftBoots: false,
      castingAbilityId: state.castingAbilityId,
    }
    const result = reconcileLocal(ack, this.localInputHistory, renderPos, ctx)

    if (result.correction === "snap") {
      renderPos.x = result.renderX
      renderPos.y = result.renderY
      entry.smoothRemainingMs = 0
    } else if (result.correction === "smooth") {
      entry.smoothFromX = renderPos.x
      entry.smoothFromY = renderPos.y
      entry.smoothTargetX = result.targetX
      entry.smoothTargetY = result.targetY
      entry.smoothRemainingMs = REPLAY_SMOOTHING_MS
    }
    // "none": keep render as-is.
  }

  /**
   * Spawns a new player sprite, foot identity ellipse, name tag, and HP bar.
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

    const footColor = HERO_CONFIGS[heroId]?.tint ?? 0xffffff
    const isLocal = playerId === this.localPlayerId

    const sprite = this.scene.add.sprite(x, y, "lady-wizard")
    sprite.setOrigin(0.5, 1.0)
    sprite.clearTint()
    sprite.setDepth(y)
    this.group.add(sprite)

    const footY = y + FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT
    const footMarker = this.scene.add.ellipse(
      x,
      footY,
      FOOT_MARKER_W,
      FOOT_MARKER_H,
      footColor,
      1,
    )
    footMarker.setDepth(y - FOOT_MARKER_DEPTH_EPS)

    const { nameTagBottomY } = computeHeroHudYOffsets(y)
    const nameTag = this.scene.add
      .text(x, nameTagBottomY, username, {
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
      footMarker,
      nameTag,
      hpBar,
      invulnTime: 0,
      flashRemaining: 0,
      lastAnimKey: "",
      smoothRemainingMs: 0,
      smoothFromX: x,
      smoothFromY: y,
      smoothTargetX: x,
      smoothTargetY: y,
    })
    ClientRenderPos[id] = { x, y }
    this.onAuthoritativePosition(id, x, y, "spawn")
  }

  /** Removes a player sprite and its UI elements. */
  private _despawnPlayer(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.sprite.destroy()
    entry.footMarker.destroy()
    entry.nameTag.destroy()
    entry.hpBar.destroy()
    this.entries.delete(id)
    removeEntity(id)
    this.remoteBuffer.remove(id)
    delete ClientPosition[id]
    delete ClientRenderPos[id]
    delete ClientPlayerState[id]
  }

  /** Triggers a red damage flash on a player sprite. */
  triggerDamageFlash(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.flashRemaining = DAMAGE_FLASH_MS
    entry.sprite.setTint(0xff0000)
  }

  /** Handles a PlayerDeath event: hides name tag + HP bar, plays death state. */
  onPlayerDeath(payload: PlayerDeathPayload): void {
    for (const [, state] of Object.entries(ClientPlayerState)) {
      if (state.playerId === payload.playerId) {
        state.animState = "dying"
        break
      }
    }
  }

  /** Handles a PlayerRespawn event: snaps sprite to spawn position. */
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
   * Main per-frame update. Interpolates positions, updates animations,
   * damage flashes, invulnerability pulse, name tags, and HP bars.
   *
   * Local players run pure prediction + smoothing. Remote players are
   * sampled from the interpolation buffer at `now - REMOTE_RENDER_DELAY_MS`.
   *
   * @param delta - Frame delta time in ms.
   * @param localMoveIntent - Local player's current movement intent for prediction.
   */
  update(delta: number, localMoveIntent: MoveIntent): void {
    const nowLocal = Date.now()
    const nowServer = nowLocal + this.serverTimeOffsetMs
    const renderTimeServer = nowServer - REMOTE_RENDER_DELAY_MS

    for (const [id, entry] of this.entries) {
      const state = ClientPlayerState[id]
      const authPos = ClientPosition[id]
      const renderPos = ClientRenderPos[id]
      if (!state || !authPos || !renderPos) continue

      const isLocal = state.playerId === this.localPlayerId
      if (isLocal) {
        this._updateLocal(entry, renderPos, state, localMoveIntent, delta)
      } else {
        this._updateRemote(id, entry, renderPos, state, authPos, renderTimeServer)
      }

      entry.sprite.setPosition(renderPos.x, renderPos.y)
      entry.sprite.setDepth(renderPos.y)

      const footY = renderPos.y + FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT
      entry.footMarker.setPosition(renderPos.x, footY)
      entry.footMarker.setDepth(renderPos.y - FOOT_MARKER_DEPTH_EPS)

      // --- Animation ---
      const isDying = state.animState === "dying" || state.animState === "dead"
      const angleForSprite = animUsesMouseAim(state.animState)
        ? state.facingAngle
        : this._bodyAngleForSprite(isLocal, state.animState, localMoveIntent, state.moveFacingAngle)
      const direction = getDirectionFromAngle(angleForSprite)
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
          entry.sprite.clearTint()
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
      entry.footMarker.setVisible(!hideUi)

      if (!hideUi) {
        const { nameTagBottomY, hpBarTopY } = computeHeroHudYOffsets(renderPos.y)
        entry.nameTag.setPosition(renderPos.x, nameTagBottomY)
        entry.nameTag.setDepth(renderPos.y + 1)

        const hpFraction = state.maxHealth > 0 ? state.health / state.maxHealth : 0
        this._drawHpBar(entry.hpBar, renderPos.x, hpBarTopY, hpFraction)
        entry.hpBar.setDepth(renderPos.y + 1)
      }
    }
  }

  /**
   * Local-player render path: extrapolate from current render by current
   * WASD input each frame (pure prediction), then apply any active smoothing
   * correction from the last reconciliation ack.
   */
  private _updateLocal(
    entry: PlayerRenderEntry,
    renderPos: { x: number; y: number },
    state: (typeof ClientPlayerState)[number],
    moveIntent: MoveIntent,
    delta: number,
  ): void {
    const castMoveMult = this._clientCastMoveMultiplier(state)
    if (this._canPredictMovement(state.animState, moveIntent, castMoveMult)) {
      const { dx, dy } = normalizedMoveFromWASD(moveIntent)
      const step = worldStepFromIntent(
        dx,
        dy,
        BASE_MOVE_SPEED_PX_PER_SEC,
        delta / 1000,
        castMoveMult,
      )
      renderPos.x += step.x
      renderPos.y += step.y
    }

    if (entry.smoothRemainingMs > 0) {
      entry.smoothRemainingMs = Math.max(0, entry.smoothRemainingMs - delta)
      const t = 1 - entry.smoothRemainingMs / REPLAY_SMOOTHING_MS
      renderPos.x =
        entry.smoothFromX + (entry.smoothTargetX - entry.smoothFromX) * t
      renderPos.y =
        entry.smoothFromY + (entry.smoothTargetY - entry.smoothFromY) * t
    }
  }

  /**
   * Remote render path: sample the interpolation buffer at the delayed
   * server render time, with velocity-aware extrapolation when the buffer
   * underflows. Falls back to the latest authoritative position if the
   * buffer has nothing yet.
   */
  private _updateRemote(
    id: number,
    _entry: PlayerRenderEntry,
    renderPos: { x: number; y: number },
    state: (typeof ClientPlayerState)[number],
    authPos: { x: number; y: number },
    renderTimeServer: number,
  ): void {
    const s = this.remoteBuffer.sampleAt(id, renderTimeServer)
    if (!s) {
      // No buffer yet — use latest authoritative (same as the old path).
      renderPos.x = authPos.x
      renderPos.y = authPos.y
      return
    }

    // Large jumps (e.g. respawn): snap to avoid stretching the sprite across
    // the arena through two-point interpolation.
    const dx = s.x - renderPos.x
    const dy = s.y - renderPos.y
    if (Math.sqrt(dx * dx + dy * dy) > TELEPORT_THRESHOLD_PX) {
      renderPos.x = s.x
      renderPos.y = s.y
    } else {
      renderPos.x = s.x
      renderPos.y = s.y
    }
    // Prefer the facing from the sampled snapshot when available.
    state.facingAngle = s.facingAngle
    state.moveFacingAngle = s.moveFacingAngle
  }

  /**
   * Body-facing radians for idle/walk sprites: local WASD prediction while moving,
   * otherwise authoritative `moveFacingAngle`.
   *
   * @param isLocal - Whether this entity is the local player.
   * @param animState - Current animation state from the server.
   * @param moveIntent - Current held movement keys for the local player.
   * @param authoritativeMoveFacing - Last authoritative body angle from the server.
   * @returns Angle in radians for `getDirectionFromAngle`.
   */
  private _bodyAngleForSprite(
    isLocal: boolean,
    animState: PlayerAnimState,
    moveIntent: MoveIntent,
    authoritativeMoveFacing: number,
  ): number {
    if (isLocal && (animState === "idle" || animState === "walk")) {
      const { dx, dy } = normalizedMoveFromWASD(moveIntent)
      if (dx !== 0 || dy !== 0) {
        return Math.atan2(dy, dx)
      }
    }
    return authoritativeMoveFacing
  }

  /**
   * Redraws the HP bar graphics for a player.
   */
  private _drawHpBar(gfx: Phaser.GameObjects.Graphics, cx: number, y: number, fraction: number): void {
    gfx.clear()
    gfx.fillStyle(0x000000, 0.7)
    gfx.fillRect(cx - HP_BAR_WIDTH / 2, y, HP_BAR_WIDTH, HP_BAR_HEIGHT)
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
   * Resolves per-tick move scale for local prediction to match server
   * `castMoveSpeedMultiplier` (with animState fallbacks for older payloads).
   */
  private _clientCastMoveMultiplier(state: (typeof ClientPlayerState)[number]): number {
    if (state.castingAbilityId) {
      const cfg = ABILITY_CONFIGS[state.castingAbilityId]
      if (cfg) return cfg.castMoveSpeedMultiplier
    }
    if (state.animState === "heavy_cast") {
      return ABILITY_CONFIGS.lightning_bolt?.castMoveSpeedMultiplier ?? 0
    }
    if (state.animState === "light_cast") {
      return ABILITY_CONFIGS.fireball?.castMoveSpeedMultiplier ?? 0
    }
    return 1
  }

  /** Returns whether local client prediction should run for this frame. */
  private _canPredictMovement(
    animState: PlayerAnimState,
    moveIntent: MoveIntent,
    castMoveMult: number,
  ): boolean {
    const { dx, dy } = normalizedMoveFromWASD(moveIntent)
    if (dx === 0 && dy === 0) return false
    if (animState === "dying" || animState === "dead" || animState === "axe_swing") {
      return false
    }
    if (animState === "light_cast" || animState === "heavy_cast") {
      return castMoveMult > 0
    }
    return true
  }

  /**
   * World position of the local player's foot anchor (same as {@link ClientRenderPos} for
   * that entity), for camera follow. Returns null if no local id or no render pos yet.
   */
  getLocalPlayerRenderPos(): { x: number; y: number } | null {
    if (!this.localPlayerId) return null
    for (const [idStr, state] of Object.entries(ClientPlayerState)) {
      if (state.playerId === this.localPlayerId) {
        const p = ClientRenderPos[Number(idStr)]
        if (p) return { x: p.x, y: p.y }
      }
    }
    return null
  }

  /** Removes all player sprites and entries. Call on scene shutdown. */
  destroy(): void {
    for (const [id] of this.entries) {
      this._despawnPlayer(id)
    }
    this.localInputHistory.clear()
    this.remoteBuffer.clear()
  }
}
