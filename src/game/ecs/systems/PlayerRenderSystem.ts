import Phaser from "phaser"

import { HERO_CONFIGS } from "@/shared/balance-config/heroes"
import { ABILITY_CONFIGS } from "@/shared/balance-config/abilities"
import {
  PREDICTION_SNAP_THRESHOLD_PX,
  REMOTE_RENDER_DELAY_MS,
  REPLAY_SMOOTHING_MS,
  TELEPORT_THRESHOLD_PX,
  TICK_DT_SEC,
  TICK_MS,
} from "@/shared/balance-config/rendering"
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import {
  BASE_MOVE_SPEED_PX_PER_SEC,
  DAMAGE_FLASH_MS,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  SWING_MOVE_SPEED_MULTIPLIER,
} from "@/shared/balance-config/combat"
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
import { moveWithinWorld } from "@/shared/collision/worldCollision"
import {
  ClientPosition,
  ClientPlayerState,
  ClientRenderPos,
} from "../components"
import { WW_LOCAL_PLAYER_ID_REGISTRY_KEY } from "../../constants"
import { addEntity, removeEntity } from "../world"
import { animUsesMouseAim } from "@/shared/playerAnimAim"
import {
  getDirectionFromAngle,
  getAnimKey,
} from "../../animation/LadyWizardAnimDefs"
import {
  LADY_WIZARD_FRAME_SIZE_PX,
  LADY_WIZARD_SPRITE_DISPLAY_OFFSET_X,
  LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y,
} from "@/shared/sprites/ladyWizard"
import {
  FIREBALL_CHANNEL_ANIM,
  FIREBALL_CHANNEL_TEXTURE,
} from "../../animation/FireballAnimDefs"
import {
  reconcileLocal,
  type LocalAckState,
  type LocalReplayContext,
} from "./ReconciliationSystem"
import { LocalInputHistory } from "../../network/LocalInputHistory"
import { RemoteInterpolationBuffer } from "./RemoteInterpolationBuffer"

/**
 * Upper bound on the accumulated sim debt we'll let Phaser's `update()`
 * replay in a single frame. Prevents a "spiral of death" if the tab was
 * backgrounded or the thread was GC-paused for seconds — we clamp the
 * catch-up to a fixed budget and drop the rest.
 */
const MAX_SIM_LAG_MS = 250
const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

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
export const LADY_WIZARD_FRAME_HEIGHT_PX = LADY_WIZARD_FRAME_SIZE_PX

/**
 * Visual nudge of the **sprite** only, in world pixels, without moving simulation, camera
 * follow, foot ellipse, or nametag/HP (they stay on {@link ClientRenderPos}). Positive
 * `X` = right, positive `Y` = down. Use to align the drawn art with the logical foot.
 */
export {
  LADY_WIZARD_SPRITE_DISPLAY_OFFSET_X,
  LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y,
} from "@/shared/sprites/ladyWizard"

function ladyWizardSpriteDisplayPos(footX: number, footY: number) {
  return {
    x: footX + LADY_WIZARD_SPRITE_DISPLAY_OFFSET_X,
    y: footY + LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y,
  }
}

/** Pixels between nametag bottom (`setOrigin(0.5, 1)`) and HP bar top (`_drawHpBar` y). */
export const NAME_TO_HP_BAR_GAP_PX = 3

/** Pixels of vertical gap from sprite texture top to the bottom edge of the HP bar. */
export const HUD_CLEARANCE_ABOVE_SPRITE_TOP_PX = -70

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
  const hpBarTopY =
    spriteTopY - HUD_CLEARANCE_ABOVE_SPRITE_TOP_PX - HP_BAR_HEIGHT
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
 * Offset from foot anchor (`renderPos.y`, texture bottom) to the ellipse center (px).
 * Positive = down-screen. Exported for unit tests; tune here.
 */
export const FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT = 11

/** Pixel distance from the wizard anchor to the channel-cast overlay center. */
const FIREBALL_CHANNEL_OFFSET_PX = 36
/** Vertical bias so the channel sprite sits at the wizard's hand height, not feet. */
const FIREBALL_CHANNEL_Y_BIAS_PX = -40
/**
 * Extra downward offset when facing is mostly east or west (`facingAngle` from
 * `atan2(dy, dx)`). Uses `|sin(angle)|` so pure N/S cardinals are unchanged.
 */
const FIREBALL_CHANNEL_EAST_WEST_Y_NUDGE_PX = 30
/** Treat as E/W when `|sin(facingAngle)|` is below this (≈30° from horizontal). */
const FIREBALL_CHANNEL_EAST_WEST_SIN_MAX = 0.5
/** Display scale for the channel sprite sheet — tuned to match wizard scale. */
const FIREBALL_CHANNEL_SCALE = 0.35
/** Tiny depth bump so the channel renders just above the casting wizard. */
const FIREBALL_CHANNEL_DEPTH_EPS = 0.5

/** Per-entity rendering state that lives outside the shared ECS records. */
interface PlayerRenderEntry {
  sprite: Phaser.GameObjects.Sprite
  /** Colored ellipse under the feet; scene-owned (not in `playerGroup`). */
  footMarker: Phaser.GameObjects.Ellipse
  nameTag: Phaser.GameObjects.Text
  hpBar: Phaser.GameObjects.Graphics
  /**
   * Lazily-allocated overlay sprite that plays the fireball channel animation
   * in front of the wizard while a fireball is being cast. `null` until the
   * player first casts fireball; hidden between casts to avoid object churn.
   */
  channelOverlay: Phaser.GameObjects.Sprite | null
  /** Accumulated time for invulnerability pulse (ms). */
  invulnTime: number
  /** Remaining damage flash time (ms). 0 = no flash active. */
  flashRemaining: number
  /** Last known animState + direction key to avoid redundant anim calls. */
  lastAnimKey: string
  /**
   * Remaining ms in the current "smooth replay correction" window. When > 0
   * each sim step is blended from the predicted position toward
   * `smoothTargetX/Y`, so the correction decays to zero without overwriting
   * live WASD prediction.
   */
  smoothRemainingMs: number
  smoothTargetX: number
  smoothTargetY: number
  /**
   * Fixed-step sim state for the **local** player. `simPrev` is the
   * committed sim position at the start of the current sim tick; `simCurr`
   * is the committed sim position after prediction + smoothing for the
   * tick. The rendered position each frame is `lerp(simPrev, simCurr,
   * alpha)` where `alpha = renderAccumulatorMs / TICK_MS`. Remote entries
   * do not use these — remote render path samples the interpolation
   * buffer directly.
   */
  simPrevX: number
  simPrevY: number
  simCurrX: number
  simCurrY: number
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
  readonly remoteBuffer: RemoteInterpolationBuffer =
    new RemoteInterpolationBuffer()

  /**
   * Offset from server clock to local clock, roughly `serverTime - Date.now()`.
   * Updated on every authoritative batch so remote interpolation can map
   * `now - REMOTE_RENDER_DELAY_MS` into server-time for sampling.
   */
  private serverTimeOffsetMs = 0

  /**
   * Accumulated real-time debt waiting to be drained into `TICK_MS` sim
   * steps. Grows by frame `delta` each `update()` and is consumed in
   * whole-tick chunks by {@link _simStepLocal}. The residual is used as
   * the render interpolation `alpha` between `simPrev` and `simCurr`.
   */
  private simAccumulatorMs = 0

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
        this._spawnPlayer(
          snap.id,
          snap.playerId,
          snap.username,
          snap.heroId,
          snap.x,
          snap.y,
        )
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
      entry.simPrevX = x
      entry.simPrevY = y
      entry.simCurrX = x
      entry.simCurrY = y
      const sp = ladyWizardSpriteDisplayPos(x, y)
      entry.sprite.setPosition(sp.x, sp.y)
      entry.sprite.setDepth(y + LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y)
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
   *
   * Reconciliation compares against the latest **committed sim position**
   * (`simCurr`), not the interpolated rendered position, because replay
   * itself is a fixed-step sim that only has meaning relative to committed
   * sim state. Render interpolation between `simPrev` and `simCurr` runs
   * a separate visual layer on top.
   */
  onLocalAck(id: number, ack: LocalAckState): void {
    const entry = this.entries.get(id)
    if (!entry) return
    const state = ClientPlayerState[id]
    const renderPos = ClientRenderPos[id]
    if (!state || !renderPos) return

    const ctx: LocalReplayContext = {
      isSwinging: state.animState === "primary_melee_attack",
      hasSwiftBoots: false,
      castingAbilityId: state.castingAbilityId,
    }
    const simCurr = { x: entry.simCurrX, y: entry.simCurrY }
    const result = reconcileLocal(ack, this.localInputHistory, simCurr, ctx)

    if (result.correction === "snap") {
      // Snap collapses both prev and curr so render interpolation does
      // not pull through the snap over the next frame.
      entry.simPrevX = result.renderX
      entry.simPrevY = result.renderY
      entry.simCurrX = result.renderX
      entry.simCurrY = result.renderY
      renderPos.x = result.renderX
      renderPos.y = result.renderY
      entry.smoothRemainingMs = 0
    } else if (result.correction === "smooth") {
      entry.smoothTargetX = result.targetX
      entry.smoothTargetY = result.targetY
      entry.smoothRemainingMs = REPLAY_SMOOTHING_MS
    }
    // "none": keep sim + render as-is.
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

    const sp0 = ladyWizardSpriteDisplayPos(x, y)
    const sprite = this.scene.add.sprite(sp0.x, sp0.y, "lady-wizard")
    sprite.setOrigin(0.5, 1.0)
    sprite.clearTint()
    sprite.setDepth(y + LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y)
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
      channelOverlay: null,
      invulnTime: 0,
      flashRemaining: 0,
      lastAnimKey: "",
      smoothRemainingMs: 0,
      smoothTargetX: x,
      smoothTargetY: y,
      simPrevX: x,
      simPrevY: y,
      simCurrX: x,
      simCurrY: y,
    })
    ClientRenderPos[id] = { x, y }
    this.onAuthoritativePosition(id, x, y, "spawn")
  }

  /**
   * Test-only escape hatch: overwrite the fixed-step sim state for a
   * local entity. Used by unit tests to set up reconciliation
   * preconditions (e.g. "prediction has drifted 10 px ahead of the ack")
   * without driving many `update()` calls just to build the setup.
   * Prefixed with `_` and guarded with a dev-mode check in callers —
   * **do not** invoke from production code paths.
   *
   * @internal
   */
  _setLocalSimForTest(
    id: number,
    next: {
      simPrevX: number
      simPrevY: number
      simCurrX: number
      simCurrY: number
    },
  ): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.simPrevX = next.simPrevX
    entry.simPrevY = next.simPrevY
    entry.simCurrX = next.simCurrX
    entry.simCurrY = next.simCurrY
  }

  /**
   * Test-only escape hatch: reads the current fixed-step sim state for
   * a local entity. See {@link _setLocalSimForTest} caveats.
   *
   * @internal
   */
  _getLocalSimForTest(
    id: number,
  ): {
    simPrevX: number
    simPrevY: number
    simCurrX: number
    simCurrY: number
    smoothRemainingMs: number
  } | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    return {
      simPrevX: entry.simPrevX,
      simPrevY: entry.simPrevY,
      simCurrX: entry.simCurrX,
      simCurrY: entry.simCurrY,
      smoothRemainingMs: entry.smoothRemainingMs,
    }
  }

  /** Removes a player sprite and its UI elements. */
  private _despawnPlayer(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.sprite.destroy()
    entry.footMarker.destroy()
    entry.nameTag.destroy()
    entry.hpBar.destroy()
    entry.channelOverlay?.destroy()
    this.entries.delete(id)
    removeEntity(id)
    this.remoteBuffer.remove(id)
    delete ClientPosition[id]
    delete ClientRenderPos[id]
    delete ClientPlayerState[id]
  }

  /**
   * Returns whether the channel-cast overlay should be shown for `state`.
   *
   * Strict AND: the player must be in the `light_cast` animation state AND
   * the server-reported `castingAbilityId` must be `"fireball"`. Mismatches
   * (e.g. `light_cast` without an ability id) hide the overlay rather than
   * guess. Exposed as a function so tests can exercise the rule directly.
   */
  static shouldShowFireballChannel(
    state: Pick<(typeof ClientPlayerState)[number], "animState" | "castingAbilityId">,
  ): boolean {
    return state.animState === "light_cast" && state.castingAbilityId === "fireball"
  }

  /**
   * Updates (and lazily creates) the channel-cast overlay for one player.
   *
   * Visible iff {@link PlayerRenderSystem.shouldShowFireballChannel} returns
   * true. Position offsets along `state.facingAngle` so the projectile-to-be
   * sits in front of the wizard regardless of which way they aim. Depth is
   * the wizard sprite depth + a small epsilon so the overlay always renders
   * above the casting body while staying inside the existing Y-sort scheme.
   */
  private _updateChannelOverlay(
    entry: PlayerRenderEntry,
    renderPos: { x: number; y: number },
    state: (typeof ClientPlayerState)[number],
  ): void {
    const show = PlayerRenderSystem.shouldShowFireballChannel(state)

    if (!show) {
      if (entry.channelOverlay && entry.channelOverlay.visible) {
        entry.channelOverlay.setVisible(false)
      }
      return
    }

    if (!entry.channelOverlay) {
      const overlay = this.scene.add.sprite(
        renderPos.x,
        renderPos.y,
        FIREBALL_CHANNEL_TEXTURE,
      )
      overlay.setOrigin(0.5, 0.5)
      overlay.setScale(FIREBALL_CHANNEL_SCALE)
      entry.channelOverlay = overlay
    }

    const overlay = entry.channelOverlay
    if (!overlay.anims.isPlaying || overlay.anims.currentAnim?.key !== FIREBALL_CHANNEL_ANIM) {
      if (this.scene.anims.exists(FIREBALL_CHANNEL_ANIM)) {
        overlay.play({ key: FIREBALL_CHANNEL_ANIM, repeat: -1 }, true)
      }
    }

    const dx = Math.cos(state.facingAngle) * FIREBALL_CHANNEL_OFFSET_PX
    const dy = Math.sin(state.facingAngle) * FIREBALL_CHANNEL_OFFSET_PX
    const eastWestNudge =
      Math.abs(Math.sin(state.facingAngle)) < FIREBALL_CHANNEL_EAST_WEST_SIN_MAX
        ? FIREBALL_CHANNEL_EAST_WEST_Y_NUDGE_PX
        : 0
    overlay.setPosition(
      renderPos.x + dx,
      renderPos.y + dy + FIREBALL_CHANNEL_Y_BIAS_PX + eastWestNudge,
    )
    overlay.setDepth(renderPos.y + FIREBALL_CHANNEL_DEPTH_EPS)
    overlay.setVisible(true)
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
        this.onAuthoritativePosition(
          id,
          payload.spawnX,
          payload.spawnY,
          "respawn",
        )
        break
      }
    }
  }

  /**
   * Main per-frame update. Drains accumulated real-time debt into
   * whole-tick **sim steps** (deterministic, fixed `TICK_MS` cadence)
   * then runs a single **render step** that interpolates each local
   * entity between `simPrev` and `simCurr` using the residual
   * accumulator as `alpha`. Remote players are sampled from the
   * interpolation buffer at `now - REMOTE_RENDER_DELAY_MS`.
   *
   * Arena threads an `onSimStep` callback through here so input send +
   * history append happen exactly **once per committed sim tick**,
   * matching the server's 60 Hz tick cadence regardless of client
   * render FPS. Variable-delta drift between prediction and replay is
   * therefore eliminated.
   *
   * @param delta - Frame delta time in ms.
   * @param localMoveIntent - Local player's current movement intent for prediction.
   * @param onSimStep - Optional callback invoked once per sim tick
   *   after prediction has advanced, used by Arena to append to the
   *   local input history and `sendPlayerInput` so each network
   *   payload corresponds to exactly one committed prediction tick.
   */
  update(
    delta: number,
    localMoveIntent: MoveIntent,
    onSimStep?: () => void,
  ): void {
    this.simAccumulatorMs = Math.min(
      this.simAccumulatorMs + delta,
      MAX_SIM_LAG_MS,
    )
    while (this.simAccumulatorMs >= TICK_MS) {
      this.simAccumulatorMs -= TICK_MS
      this._simStep(localMoveIntent)
      onSimStep?.()
    }

    const alpha = TICK_MS > 0 ? this.simAccumulatorMs / TICK_MS : 0
    this._renderStep(delta, alpha, localMoveIntent)
  }

  /**
   * Runs one fixed-step simulation tick for every local-player entry:
   * advances `simCurr` by one `TICK_DT_SEC` of prediction, then applies
   * the A-fix smoothing blend (additive decay toward `smoothTarget` on
   * top of prediction, not an absolute rail). `simPrev` is snapshotted
   * first so the subsequent render step can interpolate visually across
   * the newly-committed tick.
   */
  private _simStep(localMoveIntent: MoveIntent): void {
    for (const [id, entry] of this.entries) {
      const state = ClientPlayerState[id]
      if (!state) continue
      const isLocal = state.playerId === this.localPlayerId
      if (!isLocal) continue

      entry.simPrevX = entry.simCurrX
      entry.simPrevY = entry.simCurrY

      const castMoveMult = this._clientCastMoveMultiplier(state)
      const swingMult =
        state.animState === "primary_melee_attack"
          ? SWING_MOVE_SPEED_MULTIPLIER
          : 1
      if (
        this._canPredictMovement(state.animState, localMoveIntent, castMoveMult)
      ) {
        const { dx, dy } = normalizedMoveFromWASD(localMoveIntent)
        const step = worldStepFromIntent(
          dx,
          dy,
          BASE_MOVE_SPEED_PX_PER_SEC,
          TICK_DT_SEC,
          castMoveMult * swingMult,
        )
        const moved = moveWithinWorld(
          entry.simCurrX,
          entry.simCurrY,
          step.x,
          step.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
          ARENA_WORLD_COLLIDERS,
        )
        entry.simCurrX = moved.x
        entry.simCurrY = moved.y
      }

      if (entry.smoothRemainingMs > 0) {
        entry.smoothRemainingMs = Math.max(
          0,
          entry.smoothRemainingMs - TICK_MS,
        )
        const t = 1 - entry.smoothRemainingMs / REPLAY_SMOOTHING_MS
        const pPredX = entry.simCurrX
        const pPredY = entry.simCurrY
        const targetStepX = pPredX + (entry.smoothTargetX - pPredX) * t - pPredX
        const targetStepY = pPredY + (entry.smoothTargetY - pPredY) * t - pPredY
        const moved = moveWithinWorld(
          pPredX,
          pPredY,
          targetStepX,
          targetStepY,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
          ARENA_WORLD_COLLIDERS,
        )
        entry.simCurrX = moved.x
        entry.simCurrY = moved.y

        const remainingDx = entry.smoothTargetX - entry.simCurrX
        const remainingDy = entry.smoothTargetY - entry.simCurrY
        const remainingDist = Math.sqrt(
          remainingDx * remainingDx + remainingDy * remainingDy,
        )
        if (
          entry.smoothRemainingMs === 0 &&
          remainingDist > PREDICTION_SNAP_THRESHOLD_PX
        ) {
          entry.simPrevX = entry.smoothTargetX
          entry.simPrevY = entry.smoothTargetY
          entry.simCurrX = entry.smoothTargetX
          entry.simCurrY = entry.smoothTargetY
        }
      }
    }
  }

  /**
   * Runs the per-frame render pass at whatever rate Phaser calls
   * `update()`. For local entries, `renderPos = lerp(simPrev, simCurr,
   * alpha)` where `alpha = simAccumulatorMs / TICK_MS` — the standard
   * "render between committed sim states" pattern (Quake / Source /
   * Overwatch). Remote entries and all VFX / HUD / animation paths are
   * variable-delta exactly as before.
   */
  private _renderStep(
    delta: number,
    alpha: number,
    localMoveIntent: MoveIntent,
  ): void {
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
        renderPos.x =
          entry.simPrevX + (entry.simCurrX - entry.simPrevX) * alpha
        renderPos.y =
          entry.simPrevY + (entry.simCurrY - entry.simPrevY) * alpha
      } else {
        this._updateRemote(
          id,
          entry,
          renderPos,
          state,
          authPos,
          renderTimeServer,
        )
      }

      const sp = ladyWizardSpriteDisplayPos(renderPos.x, renderPos.y)
      entry.sprite.setPosition(sp.x, sp.y)
      entry.sprite.setDepth(renderPos.y + LADY_WIZARD_SPRITE_DISPLAY_OFFSET_Y)

      const footY = renderPos.y + FOOT_MARKER_CENTER_Y_OFFSET_FROM_FOOT
      entry.footMarker.setPosition(renderPos.x, footY)
      entry.footMarker.setDepth(renderPos.y - FOOT_MARKER_DEPTH_EPS)

      // --- Animation ---
      const isDying = state.animState === "dying" || state.animState === "dead"
      const angleForSprite = animUsesMouseAim(state.animState)
        ? state.facingAngle
        : this._bodyAngleForSprite(
            isLocal,
            state.animState,
            localMoveIntent,
            state.moveFacingAngle,
          )
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
        const pulse = Math.sin(
          (entry.invulnTime / 1000) * INVULN_PULSE_HZ * Math.PI * 2,
        )
        const spriteAlpha = 0.625 + pulse * 0.0625
        entry.sprite.setAlpha(spriteAlpha)
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
        const { nameTagBottomY, hpBarTopY } = computeHeroHudYOffsets(
          renderPos.y,
        )
        entry.nameTag.setPosition(renderPos.x, nameTagBottomY)
        entry.nameTag.setDepth(renderPos.y + 1)

        const hpFraction =
          state.maxHealth > 0 ? state.health / state.maxHealth : 0
        this._drawHpBar(entry.hpBar, renderPos.x, hpBarTopY, hpFraction)
        entry.hpBar.setDepth(renderPos.y + 1)
      }

      // --- Fireball channel overlay (light_cast + castingAbilityId=fireball) ---
      if (isDying && entry.channelOverlay) {
        entry.channelOverlay.setVisible(false)
      } else if (!isDying) {
        this._updateChannelOverlay(entry, renderPos, state)
      }
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
  private _drawHpBar(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    y: number,
    fraction: number,
  ): void {
    gfx.clear()
    gfx.fillStyle(0x000000, 0.7)
    gfx.fillRect(cx - HP_BAR_WIDTH / 2, y, HP_BAR_WIDTH, HP_BAR_HEIGHT)
    const fillColor =
      fraction > 0.5
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
    const color = Phaser.Display.Color.GetColor(
      fillColor.r,
      fillColor.g,
      fillColor.b,
    )
    gfx.fillStyle(color, 1)
    gfx.fillRect(
      cx - HP_BAR_WIDTH / 2,
      y,
      Math.round(HP_BAR_WIDTH * fraction),
      HP_BAR_HEIGHT,
    )
  }

  /**
   * Resolves per-tick move scale for local prediction to match server
   * `castMoveSpeedMultiplier` (with animState fallbacks for older payloads).
   */
  private _clientCastMoveMultiplier(
    state: (typeof ClientPlayerState)[number],
  ): number {
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
    if (
      animState === "dying" ||
      animState === "dead"
    ) {
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
    const localId =
      this.localPlayerId ??
      (this.scene.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
        | string
        | undefined) ??
      null
    if (!localId) return null
    for (const [idStr, state] of Object.entries(ClientPlayerState)) {
      if (state.playerId === localId) {
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
