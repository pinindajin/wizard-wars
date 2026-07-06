import Phaser from "phaser"

import { clientLogger } from "@/lib/clientLogger"
import { HERO_CONFIGS, normalizeHeroId, type HeroId } from "@/shared/balance-config/heroes"
import { ABILITY_CONFIGS, DEFAULT_ABILITY_SLOT_0_ID } from "@/shared/balance-config/abilities"
import {
  getPrimaryAttackAnimationConfig,
  getSpellAnimationConfig,
  msToTickOffset,
} from "@/shared/balance-config/animationConfig"
import {
  PREDICTION_SNAP_THRESHOLD_PX,
  REPLAY_SMOOTHING_MS,
  TELEPORT_THRESHOLD_PX,
  TICK_DT_SEC,
  TICK_MS,
  resolveGameNetTiming,
} from "@/shared/balance-config/rendering"
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
} from "@/shared/balance-config/arena"
import {
  BASE_MOVE_SPEED_PX_PER_SEC,
  HIT_FEEDBACK_FLASH_MS,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  SWING_MOVE_SPEED_MULTIPLIER,
  SWIFT_BOOTS_SPEED_BONUS,
  JUMP_AIRBORNE_COLLIDER_EPSILON_PX,
  JUMP_GRAVITY_PX_PER_SEC2,
  JUMP_INITIAL_VZ_PX_PER_SEC,
  JUMP_SPRITE_Y_PIXELS_PER_SIM_Z,
} from "@/shared/balance-config/combat"
import type {
  GameStateSyncPayload,
  GameNetTimingPayload,
  PlayerAnimState,
  PlayerDeathPayload,
  PlayerInputPayload,
  PlayerTerrainState,
  PlayerRespawnPayload,
  PrimaryMeleeAttackPayload,
} from "@/shared/types"
import {
  normalizedMoveFromWASD,
  type MoveIntent,
  worldStepFromIntent,
} from "@/shared/movementIntent"
import { moveWithinWorldIndexed } from "@/shared/collision/indexedWorldCollision"
import { terrainColliderSetForPlayerState } from "@/shared/collision/arenaSpatialIndexes"
import {
  worldCandidateGateForPlayerState,
} from "@/shared/collision/worldCollidersForPlayer"
import {
  ClientPosition,
  ClientPlayerState,
  ClientRenderPos,
} from "../components"
import {
  WW_ABILITY_SLOTS_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
} from "../../constants"
import { addEntity, removeEntity } from "../world"
import { animUsesMouseAim } from "@/shared/playerAnimAim"
import {
  getDirectionFromAngle,
  getHeroAnimKey,
} from "../../animation/LadyWizardAnimDefs"
import { LADY_WIZARD_FRAME_SIZE_PX } from "@/shared/sprites/ladyWizard"
import { heroSpriteConfigFor } from "@/shared/sprites/heroSprites"
import {
  FIREBALL_CHANNEL_ANIM,
  FIREBALL_CHANNEL_TEXTURE,
  LAVA_LAP_ANIM,
  LAVA_LAP_TEXTURE,
} from "../../animation/FireballAnimDefs"
import {
  reconcileLocal,
  type LocalAckState,
  type LocalReplayInputContextResolver,
  type LocalReplayContext,
} from "./ReconciliationSystem"
import type { RubberbandCorrection } from "@/shared/performanceIndicators"
import {
  LocalInputHistory,
} from "../../network/LocalInputHistory"
import { RemoteInterpolationBuffer } from "./RemoteInterpolationBuffer"

/**
 * Upper bound on the accumulated sim debt we'll let Phaser's `update()`
 * replay in a single frame. Prevents a "spiral of death" if the tab was
 * backgrounded or the thread was GC-paused for seconds — we clamp the
 * catch-up to a fixed budget and drop the rest.
 */
const MAX_SIM_LAG_MS = 250
const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

type LocalInputForSimStep = PlayerInputPayload | null | undefined
type LocalInputForSimStepProvider = () => LocalInputForSimStep

type LocalPredictedCast = {
  abilityId: string
  startedInputSeq: number
  totalTicks: number
  remainingTicks: number
}

type LocalPredictedCastReplayWindow = {
  abilityId: string
  startedInputSeq: number
  totalTicks: number
}

type LocalPredictedPrimaryMeleeSwing = {
  startedInputSeq: number
  totalTicks: number
}

type LocalPredictedAbilityCooldown = {
  endsAtServerTimeMs: number
  startedInputSeq: number
}

type LocalPredictedAbilityChargeReservation = {
  startedInputSeq: number
  remainingChargesAfterReservation: number
}

type LocalPredictionTerrainContext = {
  readonly jumpZ: number
  readonly terrainState: PlayerTerrainState
  readonly jumpStartedInLava: boolean
}

function hasJumpAirLockZ(jumpZ: number | null | undefined): boolean {
  return (jumpZ ?? 0) > JUMP_AIRBORNE_COLLIDER_EPSILON_PX
}

function predictedJumpZForElapsedTicks(elapsedTicks: number): number {
  let z = JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1
  let vz = JUMP_INITIAL_VZ_PX_PER_SEC
  for (let i = 0; i < elapsedTicks; i++) {
    vz -= JUMP_GRAVITY_PX_PER_SEC2 * TICK_DT_SEC
    z += vz * TICK_DT_SEC
    if (z <= 0) return 0
  }
  return z
}

function predictedJumpAirLockTicks(): number {
  let totalTicks = 1
  let airborne = true

  while (airborne) {
    const z = predictedJumpZForElapsedTicks(totalTicks)
    airborne = hasJumpAirLockZ(z)
    if (airborne) totalTicks += 1
  }

  return totalTicks
}

const PREDICTED_JUMP_AIR_LOCK_TICKS = predictedJumpAirLockTicks()

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

function heroSpriteDisplayPos(heroId: string, footX: number, footY: number, jumpZ = 0) {
  const spriteConfig = heroSpriteConfigFor(heroId)
  const liftPx = jumpZ * JUMP_SPRITE_Y_PIXELS_PER_SIM_Z
  return {
    x: footX + spriteConfig.displayOffsetX,
    y: footY + spriteConfig.displayOffsetY - liftPx,
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
const LAVA_SUBMERGE_VISIBLE_HEIGHT_PX = 70
const LAVA_LAP_Y_OFFSET_FROM_FOOT_PX = 2
const LAVA_LAP_DEPTH_EPS = 0.75

/** Per-entity rendering state that lives outside the shared ECS records. */
interface PlayerRenderEntry {
  sprite: Phaser.GameObjects.Sprite
  /** Canonical hero id used for sprite texture and animation keys. */
  heroId: HeroId
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
  lavaLapOverlay: Phaser.GameObjects.Sprite | null
  /** Accumulated time for invulnerability pulse (ms). */
  invulnTime: number
  /** Remaining damage flash time (ms). 0 = no flash active. */
  flashRemaining: number
  /** Last known animState + direction key to avoid redundant anim calls. */
  lastAnimKey: string
  /** Payload-derived melee key held for the duration of the active swing. */
  lockedPrimaryMeleeAnimKey: string | null
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
 * interpolation-buffer render path sampled at `now - remoteRenderDelayMs`
 * with velocity-aware extrapolation when the buffer underflows.
 */
export class PlayerRenderSystem {
  private scene: Phaser.Scene
  private group: Phaser.GameObjects.Group
  private readonly log = clientLogger.child({ area: "render", subsystem: "player" })
  private entries: Map<number, PlayerRenderEntry> = new Map()

  /** Set by Arena after connection is established. */
  localPlayerId: string | null = null

  /** Local player's pending inputs (used for rewind-and-replay). */
  readonly localInputHistory: LocalInputHistory = new LocalInputHistory()

  /** Per-remote snapshot buffer used by the remote render path. */
  readonly remoteBuffer: RemoteInterpolationBuffer =
    new RemoteInterpolationBuffer()

  /** Optional React bridge for local correction classifications. */
  private predictionCorrectionHandler?: (correction: RubberbandCorrection) => void

  /** Local-only cast window used until authoritative casting state catches up. */
  private localPredictedCast: LocalPredictedCast | null = null

  /** Recently-started cast windows retained after local expiry for ACK replay. */
  private localPredictedCastReplayWindows: LocalPredictedCastReplayWindow[] = []

  private get localPredictedCastReplayWindow(): LocalPredictedCastReplayWindow | null {
    const lastIndex = this.localPredictedCastReplayWindows.length - 1
    return lastIndex >= 0 ? this.localPredictedCastReplayWindows[lastIndex]! : null
  }

  private set localPredictedCastReplayWindow(
    window: LocalPredictedCastReplayWindow | null,
  ) {
    this.localPredictedCastReplayWindows = window ? [window] : []
  }

  /** Local-only primary melee swing window used until authoritative state catches up. */
  private localPredictedPrimaryMeleeSwing: LocalPredictedPrimaryMeleeSwing | null = null

  /** Same-ability cooldown windows predicted before authoritative state catches up. */
  private readonly localPredictedAbilityCooldowns = new Map<
    string,
    LocalPredictedAbilityCooldown
  >()

  /** Charge budgets reserved by local prediction before ability-state deltas arrive. */
  private readonly localPredictedAbilityCharges = new Map<
    string,
    LocalPredictedAbilityChargeReservation[]
  >()

  /**
   * Offset from server clock to local clock, roughly `serverTime - Date.now()`.
   * Updated on every authoritative batch so remote interpolation can map
   * `now - REMOTE_RENDER_DELAY_MS` into server-time for sampling.
   */
  private serverTimeOffsetMs = 0

  /** Current remote interpolation delay derived from server visual-send timing. */
  private remoteRenderDelayMs = resolveGameNetTiming().remoteRenderDelayMs

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
    this.applyNetTiming(payload.timing)
    this.updateServerTimeOffset(payload.serverTimeMs)
    this._clearAllLocalPredictedAbilityGuards()
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
        moveState: snap.moveState,
        terrainState: snap.terrainState,
        castingAbilityId: snap.castingAbilityId,
        facingAngle: snap.facingAngle,
        moveFacingAngle: snap.moveFacingAngle,
        invulnerable: snap.invulnerable,
        jumpZ: snap.jumpZ,
        jumpStartedInLava: snap.jumpStartedInLava,
        hasSwiftBoots: snap.hasSwiftBoots,
        abilityStates: snap.abilityStates,
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
   * Applies server-provided net timing for dynamic remote interpolation.
   *
   * @param timing - Optional timing payload from `match_go` or `game_state_sync`.
   */
  applyNetTiming(timing?: Partial<GameNetTimingPayload> | null): void {
    this.remoteRenderDelayMs = resolveGameNetTiming(timing).remoteRenderDelayMs
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
      const sp = heroSpriteDisplayPos(entry.heroId, x, y)
      entry.sprite.setPosition(sp.x, sp.y)
      entry.sprite.setDepth(y + heroSpriteConfigFor(entry.heroId).displayOffsetY)
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

    const ctx: LocalReplayContext = ack.replayContext ?? {
      isSwinging: state.animState === "primary_melee_attack",
      hasSwiftBoots: state.hasSwiftBoots,
      castingAbilityId: state.castingAbilityId,
      jumpZ: state.jumpZ ?? 0,
      jumpStartedInLava: state.jumpStartedInLava ?? false,
      terrainState: state.terrainState,
      moveState: state.moveState,
    }
    const simCurr = { x: entry.simCurrX, y: entry.simCurrY }
    this._clearLocalPredictedCastFromAck(state, ack, ctx)
    this._reconcileLocalPredictedAbilityGuardsFromAuthority(state, ack, ctx)
    const result = reconcileLocal(
      ack,
      this.localInputHistory,
      simCurr,
      ctx,
      this._localReplayContextResolver(state, ctx, ack),
    )
    this.predictionCorrectionHandler?.(result.correction)

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
   * Installs a bridge for local prediction correction diagnostics.
   *
   * @param handler - Optional callback invoked after each local ACK reconciliation.
   */
  setPredictionCorrectionHandler(
    handler: ((correction: RubberbandCorrection) => void) | undefined,
  ): void {
    this.predictionCorrectionHandler = handler
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

    const canonicalHeroId = normalizeHeroId(heroId)
    const heroSpriteConfig = heroSpriteConfigFor(canonicalHeroId)
    const footColor = HERO_CONFIGS[canonicalHeroId].tint
    const isLocal = playerId === this.localPlayerId

    const sp0 = heroSpriteDisplayPos(canonicalHeroId, x, y)
    const sprite = this.scene.add.sprite(sp0.x, sp0.y, heroSpriteConfig.spriteKey)
    sprite.setOrigin(0.5, 1.0)
    sprite.clearTint()
    sprite.setDepth(y + heroSpriteConfig.displayOffsetY)
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
      heroId: canonicalHeroId,
      footMarker,
      nameTag,
      hpBar,
      channelOverlay: null,
      lavaLapOverlay: null,
      invulnTime: 0,
      flashRemaining: 0,
      lastAnimKey: "",
      lockedPrimaryMeleeAnimKey: null,
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
    entry.lavaLapOverlay?.destroy()
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
   * the server-reported `castingAbilityId` must be Fireball or Homing Orb. Mismatches
   * (e.g. `light_cast` without an ability id) hide the overlay rather than
   * guess. Exposed as a function so tests can exercise the rule directly.
   */
  static shouldShowFireballChannel(
    state: Pick<(typeof ClientPlayerState)[number], "animState" | "castingAbilityId">,
  ): boolean {
    return (
      state.animState === "light_cast" &&
      (state.castingAbilityId === "fireball" || state.castingAbilityId === "homing_orb")
    )
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
      if (this.scene.anims?.exists(FIREBALL_CHANNEL_ANIM)) {
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

  private _updateLavaSubmerge(
    entry: PlayerRenderEntry,
    renderPos: { x: number; y: number },
    state: (typeof ClientPlayerState)[number],
    isDying: boolean,
  ): void {
    const show = state.terrainState === "lava" && !isDying
    if (!show) {
      if (typeof entry.sprite.setCrop === "function") entry.sprite.setCrop()
      if (entry.lavaLapOverlay?.visible) entry.lavaLapOverlay.setVisible(false)
      return
    }

    if (typeof entry.sprite.setCrop === "function") {
      entry.sprite.setCrop(
        0,
        0,
        heroSpriteConfigFor(entry.heroId).frameSizePx,
        LAVA_SUBMERGE_VISIBLE_HEIGHT_PX,
      )
    }
    if (!entry.lavaLapOverlay) {
      const overlay = this.scene.add.sprite(renderPos.x, renderPos.y, LAVA_LAP_TEXTURE)
      overlay.setOrigin(0.5, 0.5)
      entry.lavaLapOverlay = overlay
    }

    const overlay = entry.lavaLapOverlay
    if (!overlay.anims.isPlaying || overlay.anims.currentAnim?.key !== LAVA_LAP_ANIM) {
      if (this.scene.anims?.exists(LAVA_LAP_ANIM)) {
        overlay.play({ key: LAVA_LAP_ANIM, repeat: -1 }, true)
      }
    }
    overlay.setPosition(renderPos.x, renderPos.y + LAVA_LAP_Y_OFFSET_FROM_FOOT_PX)
    overlay.setDepth(renderPos.y + LAVA_LAP_DEPTH_EPS)
    overlay.setVisible(true)
  }

  /**
   * Client-only: white hit-feedback flash for the player with this Colyseus id.
   *
   * @param userId - `playerId` in {@link ClientPlayerState} (Colyseus user id).
   */
  triggerHitFeedbackFlashForPlayerUserId(userId: string): void {
    const id = this._entityIdForPlayerUserId(userId)
    if (id === undefined) return
    this.triggerHitFeedbackFlashByEntityId(id)
  }

  /**
   * Client-only: white hit-feedback flash for a spawned client entity.
   *
   * @param id - Numeric client ECS id from `ClientPlayerState` keys.
   */
  triggerHitFeedbackFlashByEntityId(id: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.flashRemaining = HIT_FEEDBACK_FLASH_MS
    entry.sprite.setTint(0xffffff)
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
        if (state.playerId === this.localPlayerId) {
          this._clearAllLocalPredictedAbilityGuards()
        }
        break
      }
    }
  }

  /**
   * Restarts the caster's primary melee Phaser clip for this swing.
   *
   * While {@link ClientPlayerState} stays `primary_melee_attack` across chained
   * swings (held input), {@link _renderStep} keeps the same `animKey` and does
   * not call `play()` again; one-shot clips would otherwise freeze on the last
   * frame. Each authoritative `PRIMARY_MELEE_ATTACK` event invokes this so the
   * sprite replays in sync with swing VFX.
   *
   * @param payload - Server swing-start payload (`casterId`, `facingAngle`, …).
   */
  onPrimaryMeleeSwing(payload: PrimaryMeleeAttackPayload): void {
    const id = this._entityIdForPlayerUserId(payload.casterId)
    if (id === undefined) return
    const entry = this.entries.get(id)
    if (!entry) return

    const animKey = getHeroAnimKey(
      entry.heroId,
      "primary_melee_attack",
      getDirectionFromAngle(payload.facingAngle),
    )
    if (!this._canReplayMeleeAnimation(entry.sprite)) {
      this.log.debug(
        {
          event: "playerRender.primaryMelee.skipped",
          reason: "scene_or_sprite_inactive",
          casterId: payload.casterId,
        },
        "Skipped primary melee replay; scene shutting down or sprite inactive",
      )
      return
    }
    entry.sprite.play(animKey, false)
    entry.lastAnimKey = animKey
    entry.lockedPrimaryMeleeAnimKey = animKey
  }

  /**
   * Returns whether {@link Phaser.GameObjects.Sprite#play} is safe for authoritative melee replay.
   * Avoids throwing when Colyseus delivers combat events after Phaser scene shutdown.
   *
   * @param sprite - Local sprite for the caster.
   * @returns True when the scene is live and the sprite can animate.
   */
  private _canReplayMeleeAnimation(sprite: Phaser.GameObjects.Sprite): boolean {
    const status = this.scene.sys?.settings?.status
    if (
      status === Phaser.Scenes.SHUTDOWN ||
      status === Phaser.Scenes.DESTROYED
    ) {
      return false
    }
    if (!sprite.active || sprite.scene == null) return false
    const animMgr = sprite.anims?.animationManager ?? this.scene.anims
    return animMgr != null
  }

  /**
   * Resolves a Colyseus user id string to the client ECS entity id used in
   * `ClientPlayerState` / `this.entries`, if that player is present.
   *
   * @param playerUserId - `casterId` from {@link PrimaryMeleeAttackPayload}.
   * @returns Numeric entity id, or `undefined` when no match.
   */
  private _entityIdForPlayerUserId(playerUserId: string): number | undefined {
    for (const [idStr, state] of Object.entries(ClientPlayerState)) {
      if (state.playerId === playerUserId) return Number(idStr)
    }
    return undefined
  }

  /**
   * Main per-frame update. Drains accumulated real-time debt into
   * whole-tick **sim steps** (deterministic, fixed `TICK_MS` cadence)
   * then runs a single **render step** that interpolates each local
   * entity between `simPrev` and `simCurr` using the residual
   * accumulator as `alpha`. Remote players are sampled from the
   * interpolation buffer at `now - remoteRenderDelayMs`.
   *
   * Arena threads an input provider and `onSimStep` callback through here
   * so prediction, input send, and history append happen exactly **once per committed sim tick**,
   * matching the server's 60 Hz tick cadence regardless of client
   * render FPS. Variable-delta drift between prediction and replay is
   * therefore eliminated.
   *
   * @param delta - Frame delta time in ms.
   * @param localMoveIntent - Local player's current movement intent for prediction.
   * @param onSimStep - Optional callback invoked once per sim tick
   *   after prediction has advanced with the same input, used by Arena
   *   to append to the local input history and `sendPlayerInput`.
   * @param localInputForSimStep - Optional callback that builds the
   *   outbound input before prediction for this committed sim tick.
   */
  update(
    delta: number,
    localMoveIntent: MoveIntent,
    onSimStep?: (input: PlayerInputPayload | null) => void,
    localInputForSimStep?: LocalInputForSimStepProvider,
  ): void {
    this.simAccumulatorMs = Math.min(
      this.simAccumulatorMs + delta,
      MAX_SIM_LAG_MS,
    )
    while (this.simAccumulatorMs >= TICK_MS) {
      this.simAccumulatorMs -= TICK_MS
      const inputForStep = localInputForSimStep?.() ?? null
      this._simStep(localMoveIntent, inputForStep)
      onSimStep?.(inputForStep)
    }

    const alpha = this.simAccumulatorMs / TICK_MS
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
  private _simStep(
    localMoveIntent: MoveIntent,
    inputForStep: PlayerInputPayload | null,
  ): void {
    for (const [id, entry] of this.entries) {
      const state = ClientPlayerState[id]
      if (!state) continue
      const isLocal = state.playerId === this.localPlayerId
      if (!isLocal) continue

      entry.simPrevX = entry.simCurrX
      entry.simPrevY = entry.simCurrY

      this._clearLocalPredictedCastFromAuthority(state)
      const predictedPrimaryMeleeActive =
        this._localPredictedPrimaryMeleeActiveForInput(state, inputForStep)
      const localCastAbilityId = this._localCastAbilityIdForInput(
        state,
        inputForStep,
        { rejectJumpForPredictedPrimaryMelee: predictedPrimaryMeleeActive },
      )
      if (localCastAbilityId && inputForStep) {
        this._startLocalPredictedCast(state, inputForStep, localCastAbilityId)
      }
      const activeLocalPredictedCast = this._activeLocalPredictedCast(state)
      const activeLocalCastAbilityId =
        localCastAbilityId ?? activeLocalPredictedCast?.abilityId ?? null
      const predictionMoveIntent = inputForStep ?? localMoveIntent
      const castMoveMult = this._clientCastMoveMultiplier(state, activeLocalCastAbilityId)
      const swingMult =
        state.animState === "primary_melee_attack" || predictedPrimaryMeleeActive
          ? SWING_MOVE_SPEED_MULTIPLIER
          : 1
      const swiftBootsMult =
        state.animState === "primary_melee_attack" ||
        predictedPrimaryMeleeActive ||
        !state.hasSwiftBoots
          ? 1
          : 1 + SWIFT_BOOTS_SPEED_BONUS
      const terrainContext = this._localPredictionTerrainContext(
        state,
        activeLocalCastAbilityId,
        activeLocalPredictedCast,
      )
      const colliderSet = terrainColliderSetForPlayerState(terrainContext.jumpZ, terrainContext.terrainState, {
        jumpStartedInLava: terrainContext.jumpStartedInLava,
      })
      const candidateGate = worldCandidateGateForPlayerState(
        terrainContext.jumpZ,
        terrainContext.terrainState,
      )
      if (
        this._canPredictMovement(
          state,
          predictionMoveIntent,
          castMoveMult,
          activeLocalCastAbilityId,
        )
      ) {
        const { dx, dy } = normalizedMoveFromWASD(predictionMoveIntent)
        const step = worldStepFromIntent(
          dx,
          dy,
          BASE_MOVE_SPEED_PX_PER_SEC,
          TICK_DT_SEC,
          castMoveMult * swingMult * swiftBootsMult,
        )
        const moved = moveWithinWorldIndexed(
          entry.simCurrX,
          entry.simCurrY,
          step.x,
          step.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
          colliderSet,
          candidateGate,
        )
        entry.simCurrX = moved.x
        entry.simCurrY = moved.y
      }

      if (this._shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(state, inputForStep)) {
        this._startLocalPredictedPrimaryMeleeSwing(state, inputForStep!)
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
        const moved = moveWithinWorldIndexed(
          pPredX,
          pPredY,
          targetStepX,
          targetStepY,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
          colliderSet,
          candidateGate,
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
      this._consumeLocalPredictedCastTick(state)
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
    const renderTimeServer = nowServer - this.remoteRenderDelayMs

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

      entry.heroId = normalizeHeroId(state.heroId)
      const heroSpriteConfig = heroSpriteConfigFor(entry.heroId)
      const sp = heroSpriteDisplayPos(entry.heroId, renderPos.x, renderPos.y, state.jumpZ)
      entry.sprite.setPosition(sp.x, sp.y)
      entry.sprite.setDepth(renderPos.y + heroSpriteConfig.displayOffsetY)

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
      if (state.animState !== "primary_melee_attack") {
        entry.lockedPrimaryMeleeAnimKey = null
      }

      const direction = getDirectionFromAngle(angleForSprite)
      const animKey =
        state.animState === "primary_melee_attack" &&
        entry.lockedPrimaryMeleeAnimKey !== null
          ? entry.lockedPrimaryMeleeAnimKey
          : getHeroAnimKey(entry.heroId, state.animState, direction)
      if (animKey !== entry.lastAnimKey) {
        entry.sprite.play(animKey, true)
        entry.lastAnimKey = animKey
      }

      // --- Hit feedback white flash (tint cleared when flashRemaining hits 0) ---
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

      this._updateLavaSubmerge(entry, renderPos, state, isDying)

      // --- Fireball channel overlay (light_cast + light spell castingAbilityId) ---
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
    // Position is delayed through the interpolation buffer; semantic state
    // stays at the latest authoritative value so facing-only cast/melee
    // updates are not rolled back by older buffered motion samples.
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
    localCastAbilityId: string | null = null,
  ): number {
    if (state.castingAbilityId) {
      const cfg = ABILITY_CONFIGS[state.castingAbilityId]
      if (cfg) return cfg.castMoveSpeedMultiplier
    }
    if (localCastAbilityId) {
      const cfg = ABILITY_CONFIGS[localCastAbilityId]
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
    state: (typeof ClientPlayerState)[number],
    moveIntent: MoveIntent,
    castMoveMult: number,
    localCastAbilityId: string | null = null,
  ): boolean {
    const { dx, dy } = normalizedMoveFromWASD(moveIntent)
    if (dx === 0 && dy === 0) return false
    if (
      state.animState === "dying" ||
      state.animState === "dead"
    ) {
      return false
    }
    if (state.moveState === "rooted") return false
    if (localCastAbilityId) return castMoveMult > 0
    if (state.animState === "light_cast" || state.animState === "heavy_cast") {
      return castMoveMult > 0
    }
    return true
  }

  /**
   * Resolves an outbound local ability-slot input to an ability id that should
   * affect this tick's optimistic movement. Returns null when the current
   * authoritative state suggests the server will reject or ignore the cast.
   */
  private _localCastAbilityIdForInput(
    state: (typeof ClientPlayerState)[number],
    input: PlayerInputPayload | null,
    options: {
      readonly ignorePredictedCast?: boolean
      readonly ignorePredictedAbilityCooldown?: boolean
      readonly ignorePredictedAbilityCharges?: boolean
      readonly rejectJumpForPredictedPrimaryMelee?: boolean
      readonly currentServerTimeMs?: number
    } = {},
  ): string | null {
    if (!input || input.abilitySlot === null) return null
    if (
      state.animState === "dying" ||
      state.animState === "dead" ||
      state.animState === "light_cast" ||
      state.animState === "heavy_cast" ||
      state.castingAbilityId
    ) {
      return null
    }
    if (this._hasAuthoritativeJumpAirLock(state)) {
      return null
    }
    if (
      !options.ignorePredictedCast &&
      this._activeLocalPredictedCastAbilityId(state)
    ) {
      return null
    }

    const abilityId = this._abilityIdForSlot(input.abilitySlot)
    if (!abilityId || !ABILITY_CONFIGS[abilityId]) return null
    if (
      this._serverRejectsJumpCast(
        state,
        abilityId,
        options.rejectJumpForPredictedPrimaryMelee === true,
      )
    ) {
      return null
    }

    const currentServerTimeMs =
      options.currentServerTimeMs ?? this.getEstimatedServerTimeMs()
    if (
      !options.ignorePredictedAbilityCooldown &&
      this._isLocalPredictedAbilityCooldownActive(
        abilityId,
        currentServerTimeMs,
      )
    ) {
      return null
    }

    const runtime = state.abilityStates[abilityId]
    if (
      runtime?.cooldownEndsAtServerTimeMs !== null &&
      runtime?.cooldownEndsAtServerTimeMs !== undefined &&
      runtime.cooldownEndsAtServerTimeMs > currentServerTimeMs
    ) {
      return null
    }
    if (
      runtime?.charges !== null &&
      runtime?.charges !== undefined &&
      !this._hasLocalPredictedAbilityChargeAvailable(
        abilityId,
        runtime.charges,
        options.ignorePredictedAbilityCharges === true,
      )
    ) {
      return null
    }

    return abilityId
  }

  private _activeLocalPredictedCast(
    state: (typeof ClientPlayerState)[number],
  ): LocalPredictedCast | null {
    this._clearLocalPredictedCastFromAuthority(state)
    if (
      this.localPredictedCast &&
      this.localPredictedCast.remainingTicks <= 0
    ) {
      this.localPredictedCast = null
    }
    return this.localPredictedCast
  }

  private _activeLocalPredictedCastAbilityId(
    state: (typeof ClientPlayerState)[number],
  ): string | null {
    return this._activeLocalPredictedCast(state)?.abilityId ?? null
  }

  private _startLocalPredictedCast(
    state: (typeof ClientPlayerState)[number],
    input: PlayerInputPayload,
    abilityId: string,
  ): void {
    const totalTicks = this._localPredictedCastTicks(state, abilityId)
    if (totalTicks <= 0) return
    this.localPredictedCast = {
      abilityId,
      startedInputSeq: input.seq,
      totalTicks,
      remainingTicks: totalTicks,
    }
    this._retainLocalPredictedCastReplayWindow({
      abilityId,
      startedInputSeq: input.seq,
      totalTicks,
    })
    this._startLocalPredictedAbilityCooldown(
      abilityId,
      totalTicks,
      input.seq,
    )
    this._reserveLocalPredictedAbilityCharge(state, abilityId, input.seq)
  }

  private _localPredictedCastTicks(
    state: (typeof ClientPlayerState)[number],
    abilityId: string,
  ): number {
    const cfg = ABILITY_CONFIGS[abilityId]
    if (!cfg) return 0
    if (abilityId === "jump") return PREDICTED_JUMP_AIR_LOCK_TICKS
    if (cfg.castMs <= 0) return 0

    const heroId = normalizeHeroId(state.heroId)
    return Math.max(
      1,
      msToTickOffset(getSpellAnimationConfig(heroId, abilityId).durationMs),
    )
  }

  private _consumeLocalPredictedCastTick(
    state: (typeof ClientPlayerState)[number],
  ): void {
    if (!this._activeLocalPredictedCastAbilityId(state)) return
    this.localPredictedCast!.remainingTicks -= 1
    if (this.localPredictedCast!.remainingTicks <= 0) {
      this.localPredictedCast = null
    }
  }

  private _primaryMeleeSwingTicks(state: (typeof ClientPlayerState)[number]): number {
    const heroId = normalizeHeroId(state.heroId)
    const attackId = HERO_CONFIGS[heroId].primaryMeleeAttackId
    return Math.max(
      1,
      msToTickOffset(getPrimaryAttackAnimationConfig(heroId, attackId).durationMs),
    )
  }

  private _localPredictedPrimaryMeleeActiveForInput(
    state: (typeof ClientPlayerState)[number],
    input: PlayerInputPayload | null,
  ): boolean {
    if (!input || !this.localPredictedPrimaryMeleeSwing) return false
    if (state.animState === "primary_melee_attack" || state.moveState === "swinging") {
      return false
    }
    return this._inputSeqInsidePredictedPrimaryMeleeMovementWindow(
      input.seq,
      this.localPredictedPrimaryMeleeSwing,
    )
  }

  private _shouldStartLocalPredictedPrimaryMeleeSwingAfterMovement(
    state: (typeof ClientPlayerState)[number],
    input: PlayerInputPayload | null,
  ): boolean {
    if (!input?.weaponPrimary) return false
    if (
      state.animState === "dying" ||
      state.animState === "dead" ||
      this._hasAuthoritativeJumpAirLock(state) ||
      this._activeLocalPredictedCastAbilityId(state) === "jump"
    ) {
      return false
    }
    if (state.animState === "primary_melee_attack" || state.moveState === "swinging") {
      return false
    }
    const active = this.localPredictedPrimaryMeleeSwing
    if (!active) return true
    return input.seq >= active.startedInputSeq + active.totalTicks
  }

  private _startLocalPredictedPrimaryMeleeSwing(
    state: (typeof ClientPlayerState)[number],
    input: PlayerInputPayload,
  ): void {
    this.localPredictedPrimaryMeleeSwing = {
      startedInputSeq: input.seq,
      totalTicks: this._primaryMeleeSwingTicks(state),
    }
  }

  private _inputSeqInsidePredictedPrimaryMeleeMovementWindow(
    seq: number,
    swing: LocalPredictedPrimaryMeleeSwing,
  ): boolean {
    return (
      seq > swing.startedInputSeq &&
      seq <= swing.startedInputSeq + swing.totalTicks
    )
  }

  private _clearLocalPredictedCastFromAuthority(
    state: (typeof ClientPlayerState)[number],
  ): void {
    if (
      state.castingAbilityId ||
      state.moveState === "rooted" ||
      this._hasAuthoritativeJumpAirLock(state)
    ) {
      this.localPredictedCast = null
    }
  }

  private _clearAllLocalPredictedAbilityGuards(): void {
    this.localPredictedCast = null
    this.localPredictedCastReplayWindows = []
    this.localPredictedPrimaryMeleeSwing = null
    this.localPredictedAbilityCooldowns.clear()
    this.localPredictedAbilityCharges.clear()
  }

  private _clearLocalPredictedAbilityGuardsForInput(
    abilityId: string,
    startedInputSeq: number,
  ): void {
    this._clearLocalPredictedCastReplayWindowsForInput(
      abilityId,
      startedInputSeq,
    )

    const cooldown = this.localPredictedAbilityCooldowns.get(abilityId)
    if (cooldown && cooldown.startedInputSeq <= startedInputSeq) {
      this.localPredictedAbilityCooldowns.delete(abilityId)
    }

    const charges = this.localPredictedAbilityCharges.get(abilityId)
    if (charges) {
      const remainingCharges = charges.filter(
        (charge) => charge.startedInputSeq !== startedInputSeq,
      )
      if (remainingCharges.length > 0) {
        this.localPredictedAbilityCharges.set(abilityId, remainingCharges)
      } else {
        this.localPredictedAbilityCharges.delete(abilityId)
      }
    }
  }

  private _setLocalPredictedAbilityChargeReservations(
    abilityId: string,
    reservations: LocalPredictedAbilityChargeReservation[],
  ): void {
    if (reservations.length > 0) {
      this.localPredictedAbilityCharges.set(abilityId, reservations)
    } else {
      this.localPredictedAbilityCharges.delete(abilityId)
    }
  }

  private _clearLocalPredictedCastFromAck(
    state: (typeof ClientPlayerState)[number],
    ack: LocalAckState,
    ctx: LocalReplayContext,
  ): void {
    this._clearLocalPredictedCastFromAuthority(state)
    if (
      ctx.castingAbilityId ||
      ctx.moveState === "rooted" ||
      this._replayContextHasJumpAirLock(ctx)
    ) {
      return
    }

    const currentServerTimeMs = ack.serverTimeMs ?? this.getEstimatedServerTimeMs()
    const ackedCasts = this._localPredictedCastReplaySnapshot().filter(
      (cast) => ack.lastProcessedInputSeq >= cast.startedInputSeq,
    )

    for (const predictedCast of ackedCasts) {
      if (
        this.localPredictedCast?.startedInputSeq ===
        predictedCast.startedInputSeq
      ) {
        this.localPredictedCast = null
      }

      this._clearLocalPredictedCastReplayWindowsForInput(
        predictedCast.abilityId,
        predictedCast.startedInputSeq,
      )

      const serverAcceptedCast =
        this._hasAuthoritativeAbilityActiveOrCooldown(
          state,
          predictedCast.abilityId,
          ctx,
          currentServerTimeMs,
        )
      const castCouldStillBeRunning =
        ack.lastProcessedInputSeq < this._predictedCastEndSeq(predictedCast)

      if (!serverAcceptedCast || castCouldStillBeRunning) {
        this._clearLocalPredictedAbilityGuardsForInput(
          predictedCast.abilityId,
          predictedCast.startedInputSeq,
        )
      }
    }
  }

  private _reconcileLocalPredictedAbilityGuardsFromAuthority(
    state: (typeof ClientPlayerState)[number],
    ack: LocalAckState,
    ctx: LocalReplayContext,
  ): void {
    const currentServerTimeMs = ack.serverTimeMs ?? this.getEstimatedServerTimeMs()
    const allowReadyStateClear = ack.abilityStatesChanged === true

    for (const [abilityId, cooldown] of this.localPredictedAbilityCooldowns) {
      if (ack.lastProcessedInputSeq < cooldown.startedInputSeq) continue

      const runtime = state.abilityStates[abilityId]
      const cooldownEndsAtServerTimeMs = runtime?.cooldownEndsAtServerTimeMs
      if (
        cooldownEndsAtServerTimeMs !== null &&
        cooldownEndsAtServerTimeMs !== undefined &&
        cooldownEndsAtServerTimeMs > currentServerTimeMs
      ) {
        this.localPredictedAbilityCooldowns.delete(abilityId)
        continue
      }

      if (
        allowReadyStateClear &&
        this._authoritativeAbilityCooldownReady(runtime, currentServerTimeMs) &&
        !this._hasAbilityActiveInPredictionOrAuthority(state, abilityId, ctx)
      ) {
        this.localPredictedAbilityCooldowns.delete(abilityId)
      }
    }

    for (const [abilityId, reservations] of this.localPredictedAbilityCharges) {
      const runtime = state.abilityStates[abilityId]
      const charges = runtime?.charges
      if (charges === null || charges === undefined) {
        this.localPredictedAbilityCharges.delete(abilityId)
        continue
      }
      if (
        allowReadyStateClear &&
        runtime.maxCharges !== null &&
        runtime.maxCharges !== undefined &&
        charges >= runtime.maxCharges &&
        !this._hasAbilityActiveInPredictionOrAuthority(state, abilityId, ctx)
      ) {
        this.localPredictedAbilityCharges.delete(abilityId)
        continue
      }

      this._setLocalPredictedAbilityChargeReservations(
        abilityId,
        reservations.filter(
          (reservation) =>
            ack.lastProcessedInputSeq < reservation.startedInputSeq ||
            charges > reservation.remainingChargesAfterReservation,
        ),
      )
    }
  }

  private _authoritativeAbilityCooldownReady(
    runtime:
      | (typeof ClientPlayerState)[number]["abilityStates"][string]
      | undefined,
    currentServerTimeMs: number,
  ): boolean {
    if (!runtime) return false
    return (
      runtime.cooldownEndsAtServerTimeMs === null ||
      runtime.cooldownEndsAtServerTimeMs === undefined ||
      runtime.cooldownEndsAtServerTimeMs <= currentServerTimeMs
    )
  }

  private _hasAbilityActiveInPredictionOrAuthority(
    state: (typeof ClientPlayerState)[number],
    abilityId: string,
    ctx: LocalReplayContext,
  ): boolean {
    if (
      this.localPredictedCast?.abilityId === abilityId &&
      this.localPredictedCast.remainingTicks > 0
    ) {
      return true
    }
    if (
      this.localPredictedCastReplayWindows.some(
        (window) => window.abilityId === abilityId,
      )
    ) {
      return true
    }
    if (state.castingAbilityId === abilityId || ctx.castingAbilityId === abilityId) {
      return true
    }
    if (abilityId === "jump") {
      return (
        this._hasAuthoritativeJumpAirLock(state) ||
        this._replayContextHasJumpAirLock(ctx)
      )
    }
    return (
      state.moveState === "rooted" ||
      state.moveState === "casting" ||
      ctx.moveState === "rooted" ||
      ctx.moveState === "casting"
    )
  }

  private _localReplayContextResolver(
    state: (typeof ClientPlayerState)[number],
    ctx: LocalReplayContext,
    ack?: LocalAckState,
  ): LocalReplayInputContextResolver {
    const replayCasts = this._localPredictedCastReplaySnapshot()
    let replayPrimaryMelee =
      this.localPredictedPrimaryMeleeSwing !== null
        ? { ...this.localPredictedPrimaryMeleeSwing }
        : null

    return (input, baseCtx) => {
      let replayCtx = baseCtx
      const matchingBaseCtxReplayCast = this._replayCastMatchingContext(
        baseCtx,
        replayCasts,
      )
      const baseCtxHasFullyBlockingAuthority =
        baseCtx.moveState === "rooted" ||
        this._replayContextHasJumpAirLock(baseCtx)
      const baseCtxHasUnrelatedCastAuthority =
        baseCtx.castingAbilityId !== null && matchingBaseCtxReplayCast === null

      if (baseCtxHasFullyBlockingAuthority && !matchingBaseCtxReplayCast) {
        return baseCtx
      }

      const activeReplayCast = this._replayCastForInput(replayCasts, input.seq)
      const replayPrimaryMeleeActive =
        replayPrimaryMelee !== null &&
        this._inputSeqInsidePredictedPrimaryMeleeMovementWindow(
          input.seq,
          replayPrimaryMelee,
        )
      if (
        activeReplayCast &&
        !baseCtxHasUnrelatedCastAuthority
      ) {
        replayCtx = this._localReplayContextForAbility(
          baseCtx,
          activeReplayCast.abilityId,
          input.seq - activeReplayCast.startedInputSeq,
        )
      } else if (
        matchingBaseCtxReplayCast &&
        input.seq > this._predictedCastEndSeq(matchingBaseCtxReplayCast)
      ) {
        replayCtx = this._replayContextAfterPredictedCast(
          baseCtx,
          matchingBaseCtxReplayCast,
        )
      }

      if (
        !activeReplayCast &&
        !baseCtxHasUnrelatedCastAuthority &&
        !baseCtxHasFullyBlockingAuthority
      ) {
        const localCastAbilityId = this._localCastAbilityIdForInput(
          state,
          input,
          {
            ignorePredictedCast: true,
            ignorePredictedAbilityCooldown: true,
            ignorePredictedAbilityCharges: true,
            rejectJumpForPredictedPrimaryMelee: replayPrimaryMeleeActive,
            currentServerTimeMs: this._serverTimeForReplayedInput(ack, input),
          },
        )
        if (localCastAbilityId) {
          const totalTicks = this._localPredictedCastTicks(
            state,
            localCastAbilityId,
          )
          if (totalTicks > 0) {
            const replayCast = {
              abilityId: localCastAbilityId,
              startedInputSeq: input.seq,
              totalTicks,
            }
            this._retainReplayCastWindowSnapshot(replayCasts, replayCast)
            replayCtx = this._localReplayContextForAbility(
              replayCtx,
              replayCast.abilityId,
              0,
            )
          }
        }
      }

      const outputCtx = replayPrimaryMeleeActive
        ? { ...replayCtx, isSwinging: true }
        : replayCtx

      if (
        this._shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
          state,
          input,
          replayPrimaryMelee,
          replayCtx,
        )
      ) {
        replayPrimaryMelee = {
          startedInputSeq: input.seq,
          totalTicks: this._primaryMeleeSwingTicks(state),
        }
      }

      return outputCtx
    }
  }

  private _predictedCastEndSeq(cast: LocalPredictedCastReplayWindow): number {
    return cast.startedInputSeq + cast.totalTicks - 1
  }

  private _inputSeqInsidePredictedCastWindow(
    seq: number,
    cast: LocalPredictedCastReplayWindow,
  ): boolean {
    return seq >= cast.startedInputSeq && seq <= this._predictedCastEndSeq(cast)
  }

  private _retainLocalPredictedCastReplayWindow(
    window: LocalPredictedCastReplayWindow,
  ): void {
    this._retainReplayCastWindowSnapshot(
      this.localPredictedCastReplayWindows,
      window,
    )
  }

  private _retainReplayCastWindowSnapshot(
    windows: LocalPredictedCastReplayWindow[],
    window: LocalPredictedCastReplayWindow,
  ): void {
    const existingIndex = windows.findIndex(
      (candidate) => candidate.startedInputSeq === window.startedInputSeq,
    )
    if (existingIndex >= 0) {
      windows[existingIndex] = window
    } else {
      windows.push(window)
    }
    windows.sort((a, b) => a.startedInputSeq - b.startedInputSeq)
  }

  private _clearLocalPredictedCastReplayWindowsForInput(
    abilityId: string,
    startedInputSeq: number,
  ): void {
    this.localPredictedCastReplayWindows =
      this.localPredictedCastReplayWindows.filter(
        (window) =>
          window.abilityId !== abilityId ||
          window.startedInputSeq > startedInputSeq,
      )
  }

  private _localPredictedCastReplaySnapshot(): LocalPredictedCastReplayWindow[] {
    const windows = this.localPredictedCastReplayWindows.map((window) => ({
      ...window,
    }))
    if (this.localPredictedCast) {
      this._retainReplayCastWindowSnapshot(windows, {
        abilityId: this.localPredictedCast.abilityId,
        startedInputSeq: this.localPredictedCast.startedInputSeq,
        totalTicks: this.localPredictedCast.totalTicks,
      })
    }
    return windows
  }

  private _replayCastForInput(
    casts: LocalPredictedCastReplayWindow[],
    seq: number,
  ): LocalPredictedCastReplayWindow | null {
    return (
      casts.find((cast) =>
        this._inputSeqInsidePredictedCastWindow(seq, cast),
      ) ?? null
    )
  }

  private _replayCastMatchingContext(
    ctx: LocalReplayContext,
    casts: LocalPredictedCastReplayWindow[],
  ): LocalPredictedCastReplayWindow | null {
    return (
      casts.find((cast) => this._replayContextMatchesPredictedCast(ctx, cast)) ??
      null
    )
  }

  private _replayContextMatchesPredictedCast(
    ctx: LocalReplayContext,
    cast: LocalPredictedCastReplayWindow,
  ): boolean {
    return ctx.castingAbilityId === cast.abilityId
  }

  private _replayContextAfterPredictedCast(
    ctx: LocalReplayContext,
    cast: LocalPredictedCastReplayWindow,
  ): LocalReplayContext {
    if (!this._replayContextMatchesPredictedCast(ctx, cast)) return ctx
    return {
      ...ctx,
      castingAbilityId: null,
      moveState:
        ctx.moveState === "rooted" || ctx.moveState === "casting"
          ? "idle"
          : ctx.moveState,
    }
  }

  private _shouldStartLocalPredictedPrimaryMeleeSwingForReplay(
    state: (typeof ClientPlayerState)[number],
    input: PlayerInputPayload,
    activeSwing: LocalPredictedPrimaryMeleeSwing | null,
    ctx: LocalReplayContext,
  ): boolean {
    if (!input.weaponPrimary) return false
    if (
      state.animState === "dying" ||
      state.animState === "dead" ||
      this._replayContextHasJumpAirLock(ctx)
    ) {
      return false
    }
    if (ctx.isSwinging && activeSwing === null) return false
    if (!activeSwing) return true
    return input.seq >= activeSwing.startedInputSeq + activeSwing.totalTicks
  }

  private _hasAuthoritativeAbilityActiveOrCooldown(
    state: (typeof ClientPlayerState)[number],
    abilityId: string,
    ctx: LocalReplayContext,
    currentServerTimeMs: number,
  ): boolean {
    if (state.castingAbilityId === abilityId || ctx.castingAbilityId === abilityId) {
      return true
    }
    if (
      abilityId === "jump" &&
      (this._hasAuthoritativeJumpAirLock(state) ||
        this._replayContextHasJumpAirLock(ctx))
    ) {
      return true
    }
    const cooldownEndsAtServerTimeMs =
      state.abilityStates[abilityId]?.cooldownEndsAtServerTimeMs
    return (
      cooldownEndsAtServerTimeMs !== null &&
      cooldownEndsAtServerTimeMs !== undefined &&
      cooldownEndsAtServerTimeMs > currentServerTimeMs
    )
  }

  private _localReplayContextForInput(
    state: (typeof ClientPlayerState)[number],
    input: PlayerInputPayload,
    baseCtx: LocalReplayContext,
  ): LocalReplayContext {
    if (
      baseCtx.castingAbilityId ||
      baseCtx.moveState === "rooted" ||
      this._replayContextHasJumpAirLock(baseCtx)
    ) {
      return baseCtx
    }

    const localCastAbilityId = this._localCastAbilityIdForInput(
      state,
      input,
      {
        ignorePredictedCast: true,
        ignorePredictedAbilityCooldown: true,
        ignorePredictedAbilityCharges: true,
      },
    )
    if (!localCastAbilityId) return baseCtx

    return this._localReplayContextForAbility(baseCtx, localCastAbilityId, 0)
  }

  private _localReplayContextForAbility(
    baseCtx: LocalReplayContext,
    abilityId: string,
    predictedElapsedTicks: number,
  ): LocalReplayContext {
    if (abilityId === "jump") {
      return {
        ...baseCtx,
        ...this._predictedJumpTerrainContext(
          baseCtx.terrainState,
          predictedElapsedTicks,
        ),
        castingAbilityId: null,
      }
    }

    const castMoveMult =
      ABILITY_CONFIGS[abilityId].castMoveSpeedMultiplier
    return {
      ...baseCtx,
      castingAbilityId: abilityId,
      moveState: castMoveMult === 0 ? "rooted" : "casting",
    }
  }

  private _localPredictionTerrainContext(
    state: (typeof ClientPlayerState)[number],
    activeLocalCastAbilityId: string | null,
    activeLocalPredictedCast: LocalPredictedCast | null,
  ): LocalPredictionTerrainContext {
    if (activeLocalCastAbilityId === "jump") {
      const elapsedTicks =
        activeLocalPredictedCast?.abilityId === "jump"
          ? activeLocalPredictedCast.totalTicks -
            activeLocalPredictedCast.remainingTicks
          : 0
      return this._predictedJumpTerrainContext(state.terrainState, elapsedTicks)
    }

    return {
      jumpZ: state.jumpZ ?? 0,
      terrainState: state.terrainState,
      jumpStartedInLava: state.jumpStartedInLava ?? false,
    }
  }

  private _predictedJumpTerrainContext(
    terrainState: PlayerTerrainState,
    elapsedTicks: number,
  ): LocalPredictionTerrainContext {
    return {
      jumpZ: predictedJumpZForElapsedTicks(elapsedTicks),
      terrainState: "land",
      jumpStartedInLava: terrainState === "lava",
    }
  }

  private _hasAuthoritativeJumpAirLock(
    state: (typeof ClientPlayerState)[number],
  ): boolean {
    return state.animState === "jump" && hasJumpAirLockZ(state.jumpZ)
  }

  private _replayContextHasJumpAirLock(ctx: LocalReplayContext): boolean {
    return hasJumpAirLockZ(ctx.jumpZ)
  }

  private _serverRejectsJumpCast(
    state: (typeof ClientPlayerState)[number],
    abilityId: string,
    predictedPrimaryMeleeActive = false,
  ): boolean {
    return (
      abilityId === "jump" &&
      (state.moveState === "swinging" ||
        state.moveState === "knockback" ||
        state.animState === "primary_melee_attack" ||
        predictedPrimaryMeleeActive)
    )
  }

  private _startLocalPredictedAbilityCooldown(
    abilityId: string,
    castTicks: number,
    startedInputSeq: number,
  ): void {
    const cfg = ABILITY_CONFIGS[abilityId]
    if (!cfg || cfg.cooldownMs <= 0) return

    this.localPredictedAbilityCooldowns.set(abilityId, {
      endsAtServerTimeMs:
        this.getEstimatedServerTimeMs() + castTicks * TICK_MS + cfg.cooldownMs,
      startedInputSeq,
    })
  }

  private _reserveLocalPredictedAbilityCharge(
    state: (typeof ClientPlayerState)[number],
    abilityId: string,
    startedInputSeq: number,
  ): void {
    const runtime = state.abilityStates[abilityId]
    if (
      runtime?.charges === null ||
      runtime?.charges === undefined ||
      runtime.charges <= 0
    ) {
      return
    }

    const reservations = this._activeLocalPredictedAbilityChargeReservations(
      abilityId,
      runtime.charges,
    )
    reservations.push({
      startedInputSeq,
      remainingChargesAfterReservation: Math.max(
        0,
        runtime.charges - reservations.length - 1,
      ),
    })
    this._setLocalPredictedAbilityChargeReservations(abilityId, reservations)
  }

  private _isLocalPredictedAbilityCooldownActive(
    abilityId: string,
    currentServerTimeMs: number,
  ): boolean {
    this._pruneLocalPredictedAbilityCooldowns(currentServerTimeMs)
    const cooldown = this.localPredictedAbilityCooldowns.get(abilityId)
    return cooldown ? cooldown.endsAtServerTimeMs > currentServerTimeMs : false
  }

  private _pruneLocalPredictedAbilityCooldowns(
    currentServerTimeMs: number,
  ): void {
    for (const [abilityId, cooldown] of this.localPredictedAbilityCooldowns) {
      if (cooldown.endsAtServerTimeMs <= currentServerTimeMs) {
        this.localPredictedAbilityCooldowns.delete(abilityId)
      }
    }
  }

  private _hasLocalPredictedAbilityChargeAvailable(
    abilityId: string,
    charges: number,
    ignorePredictedAbilityCharges: boolean,
  ): boolean {
    if (ignorePredictedAbilityCharges) return charges > 0

    const reservations = this._activeLocalPredictedAbilityChargeReservations(
      abilityId,
      charges,
    )
    this._setLocalPredictedAbilityChargeReservations(abilityId, reservations)
    if (charges <= 0) return false

    return charges - reservations.length > 0
  }

  private _activeLocalPredictedAbilityChargeReservations(
    abilityId: string,
    charges: number,
  ): LocalPredictedAbilityChargeReservation[] {
    const reservations = this.localPredictedAbilityCharges.get(abilityId) ?? []
    return reservations.filter(
      (reservation) => charges > reservation.remainingChargesAfterReservation,
    )
  }

  private _serverTimeForReplayedInput(
    ack: LocalAckState | undefined,
    input: PlayerInputPayload,
  ): number | undefined {
    if (ack?.serverTimeMs === undefined) return undefined
    const replayedTicks = Math.max(0, input.seq - ack.lastProcessedInputSeq)
    return ack.serverTimeMs + replayedTicks * TICK_MS
  }

  /** Resolves a local ability-bar index through React-owned shop state. */
  private _abilityIdForSlot(slotIndex: number): string | null {
    const raw = this.scene.game.registry.get(WW_ABILITY_SLOTS_REGISTRY_KEY)
    if (Array.isArray(raw)) {
      const value = raw[slotIndex]
      return typeof value === "string" ? value : null
    }
    return slotIndex === 0 ? DEFAULT_ABILITY_SLOT_0_ID : null
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

  /**
   * Estimates current server time from latest authoritative batches.
   *
   * @returns Current local wall time adjusted by server offset.
   */
  getEstimatedServerTimeMs(): number {
    return Date.now() + this.serverTimeOffsetMs
  }

  /** Removes all player sprites and entries. Call on scene shutdown. */
  destroy(): void {
    for (const [id] of this.entries) {
      this._despawnPlayer(id)
    }
    this._clearAllLocalPredictedAbilityGuards()
    this.localInputHistory.clear()
    this.remoteBuffer.clear()
  }
}
