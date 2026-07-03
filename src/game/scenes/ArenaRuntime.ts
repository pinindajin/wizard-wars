import Phaser from "phaser"

import { clientLogger } from "@/lib/clientLogger"
import { WsEvent } from "@/shared/events"
import { ARENA_CAMERA_FOLLOW_ZOOM } from "@/shared/balance-config/rendering"
import type {
  GameStateSyncPayload,
  GameInputProtocolPayload,
  MatchGoPayload,
  PlayerBatchUpdatePayload,
  PlayerOwnerAckPayload,
  FireballLaunchPayload,
  FireballBatchUpdatePayload,
  FireballImpactPayload,
  HomingOrbBatchUpdatePayload,
  HomingOrbImpactPayload,
  HomingOrbLaunchPayload,
  LightningBoltPayload,
  PrimaryMeleeAttackPayload,
  CombatTelegraphStartPayload,
  CombatTelegraphEndPayload,
  PlayerDeathPayload,
  PlayerRespawnPayload,
  DamageFloatPayload,
  AbilitySfxPayload,
  PlayerInputPayload,
} from "@/shared/types"
import {
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_DEBUG_MODE_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
  WW_PREDICTION_CORRECTION_CALLBACK_REGISTRY_KEY,
  WW_ACTIVE_LOCAL_INPUT_CALLBACK_REGISTRY_KEY,
} from "../constants"
import type { MinimapCorner } from "@/shared/settings-config"
import type { RubberbandCorrection } from "@/shared/performanceIndicators"
import { GameConnection } from "../network/GameConnection"
import { PlayerRenderSystem } from "../ecs/systems/PlayerRenderSystem"
import { ProjectileRenderSystem } from "../ecs/systems/ProjectileRenderSystem"
import { LightningBoltRenderSystem } from "../ecs/systems/LightningBoltRenderSystem"
import { CombatTelegraphRenderSystem } from "../ecs/systems/CombatTelegraphRenderSystem"
import { DamageFloatersSystem } from "../ecs/systems/DamageFloatersSystem"
import { DebugOverlaySystem } from "../ecs/systems/DebugOverlaySystem"
import { NetworkSyncSystem } from "../ecs/systems/NetworkSyncSystem"
import { PlayerInputStateScheduler } from "../network/PlayerInputStateScheduler"
import { KeyboardController } from "../input/KeyboardController"
import { MouseController } from "../input/MouseController"
import { registerHeroSpriteAnims } from "../animation/LadyWizardAnimDefs"
import { registerFireballAnims } from "../animation/FireballAnimDefs"
import { SFX_KEYS } from "@/shared/balance-config/audio"
import { resolveDamageFloatLocalFeedback } from "../hitFeedback/damageFloatLocalFeedback"
import { BgmPlayer } from "../audio/BgmPlayer"
import { SoundManager } from "../audio/SoundManager"
import { WalkFootstepController } from "../audio/WalkFootstepController"
import { MinimapController } from "../minimap/MinimapController"

type ArenaRuntimeVisuals = {
  arenaWidthPx: number
  arenaHeightPx: number
}

const INACTIVE_MOVE_INTENT = {
  up: false,
  down: false,
  left: false,
  right: false,
} as const

type FullInputForActivity = {
  readonly up: boolean
  readonly down: boolean
  readonly left: boolean
  readonly right: boolean
  readonly abilitySlot: number | null
  readonly useQuickItemSlot: number | null
  readonly weaponPrimary: boolean
  readonly weaponSecondary: boolean
}

/**
 * Returns whether an outbound input contains local player activity.
 *
 * @param input - Full player input payload shape relevant to activity detection.
 * @returns True when the input should count for connection stale-message gating.
 */
function isActiveLocalInput(input: FullInputForActivity): boolean {
  return (
    input.up ||
    input.down ||
    input.left ||
    input.right ||
    input.weaponPrimary ||
    input.weaponSecondary ||
    input.abilitySlot !== null ||
    input.useQuickItemSlot !== null
  )
}

/**
 * Wall-clock fields injected into the outgoing payload at send time. Keeping
 * this stamp out of the controllers preserves controller testability.
 */
function stampClientSendTime(): { clientSendTimeMs: number } {
  return { clientSendTimeMs: Date.now() }
}

/**
 * Hand-owned Arena gameplay runtime. Phaser Editor owns visual object creation
 * in Arena.ts; this class owns all existing gameplay/network/input behavior.
 */
export class ArenaRuntime {
  /** Phaser group used to collect all player sprites for iteration. */
  playerGroup!: Phaser.GameObjects.Group

  /** Exposed for existing e2e diagnostics. */
  playerRenderSystem!: PlayerRenderSystem

  /** Active Colyseus room connection. */
  private connection!: GameConnection

  /** Removes this runtime's room message handler from the active connection. */
  private connectionUnsub?: () => void

  /** Whether this runtime created the connection and should close it on teardown. */
  private ownsConnection = false

  /** Prevents async fallback connection setup from subscribing after teardown. */
  private destroyed = false

  /**
   * Incremented on each {@link start} and {@link destroy}. Room handlers capture a
   * snapshot generation so in-flight Colyseus deliveries cannot touch systems after teardown.
   */
  private messageGeneration = 0

  private projectileRenderSystem!: ProjectileRenderSystem
  private lightningBoltRenderSystem!: LightningBoltRenderSystem
  private combatTelegraphRenderSystem!: CombatTelegraphRenderSystem
  private damageFloatersSystem!: DamageFloatersSystem
  private debugOverlaySystem!: DebugOverlaySystem
  private networkSyncSystem!: NetworkSyncSystem
  private minimapController!: MinimapController

  private keyboardController!: KeyboardController
  private mouseController!: MouseController

  private bgmPlayer!: BgmPlayer
  private soundManager!: SoundManager
  private walkFootstep!: WalkFootstepController
  private readonly log = clientLogger.child({ area: "netcode" })
  private activeLocalInputHandler?: () => void
  private inputTransport: "legacy" | "compact" = "legacy"
  private inputProtocolConfigKey: string | null = null
  private compactInputScheduler = new PlayerInputStateScheduler()

  /** Whether the match has started (MatchGo received). */
  private matchStarted = false

  /**
   * Wall clock (ms) when hazard take-hit SFX last played; used to throttle
   * environmental damage grunts only.
   */
  private lastHazardTakeHitSfxAtMs: number | null = null

  /** Pixel size of the loaded arena visual (for camera/minimap bounds). */
  private arenaWidthPx = 0
  private arenaHeightPx = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly visuals: ArenaRuntimeVisuals,
  ) {}

  /**
   * Starts the same systems previously created by Arena.editorCreate(), after
   * Phaser Editor has created the native arena image and prop visuals.
   */
  start(): void {
    this.destroyed = false
    this.messageGeneration++
    this._configureTilemap()
    this._createPlayerGroup()
    this._createSystems()
    this._setupCamera()
    this._setupMinimap()
    this._setupAudio()
    registerHeroSpriteAnims(this.scene.anims)
    registerFireballAnims(this.scene.anims)
    this._openConnection()
  }

  /**
   * Captures current runtime arena visual bounds from the editor-created map.
   */
  private _configureTilemap(): void {
    this.arenaWidthPx = this.visuals.arenaWidthPx
    this.arenaHeightPx = this.visuals.arenaHeightPx
  }

  /**
   * Creates the Phaser Group that tracks all active player sprites.
   */
  private _createPlayerGroup(): void {
    this.playerGroup = this.scene.add.group()
  }

  /**
   * Instantiates all ECS render and input systems.
   */
  private _createSystems(): void {
    this.playerRenderSystem = new PlayerRenderSystem(this.scene, this.playerGroup)
    this.playerRenderSystem.setPredictionCorrectionHandler(
      this.scene.game.registry.get(
        WW_PREDICTION_CORRECTION_CALLBACK_REGISTRY_KEY,
      ) as ((correction: RubberbandCorrection) => void) | undefined,
    )
    this.activeLocalInputHandler = this.scene.game.registry.get(
      WW_ACTIVE_LOCAL_INPUT_CALLBACK_REGISTRY_KEY,
    ) as (() => void) | undefined
    this.networkSyncSystem = new NetworkSyncSystem({
      onBatchReceived: () => {
        this.playerRenderSystem.markBatchReceived()
      },
      onAuthoritativePosition: (id, x, y, reason) => {
        this.playerRenderSystem.onAuthoritativePosition(id, x, y, reason)
      },
      onRemoteSnapshot: (sample) => {
        this.playerRenderSystem.onRemoteSnapshot(sample.id, sample)
      },
      onLocalAck: (sample) => {
        this.playerRenderSystem.onLocalAck(sample.id, {
          x: sample.x,
          y: sample.y,
          lastProcessedInputSeq: sample.lastProcessedInputSeq,
          serverTimeMs: sample.serverTimeMs,
          replayContext: sample.replayContext,
        })
      },
      onServerTime: (serverTimeMs) => {
        this.playerRenderSystem.updateServerTimeOffset(serverTimeMs)
        this.projectileRenderSystem?.updateServerTimeOffset?.(serverTimeMs)
      },
      onNetTiming: (timing) => {
        this.playerRenderSystem.applyNetTiming(timing)
        this.projectileRenderSystem?.applyNetTiming?.(timing)
      },
    })
    this.projectileRenderSystem = new ProjectileRenderSystem(this.scene)
    this.lightningBoltRenderSystem = new LightningBoltRenderSystem(this.scene)
    this.combatTelegraphRenderSystem = new CombatTelegraphRenderSystem(this.scene)
    this.damageFloatersSystem = new DamageFloatersSystem(this.scene)
    this.debugOverlaySystem = new DebugOverlaySystem(this.scene)
    this.debugOverlaySystem.setEnabled(
      this.scene.game.registry.get(WW_DEBUG_MODE_REGISTRY_KEY) === true,
    )
    this.keyboardController = new KeyboardController(this.scene)
    this.mouseController = new MouseController(this.scene)
  }

  /**
   * Configures the main camera: world bounds from the arena image, follow zoom
   * ({@link ARENA_CAMERA_FOLLOW_ZOOM}) so `centerOn` can scroll. Each frame,
   * `update` centers on the local player's foot when available.
   */
  private _setupCamera(): void {
    const cam = this.scene.cameras.main
    cam.setZoom(ARENA_CAMERA_FOLLOW_ZOOM)
    cam.setRoundPixels(true)
    if (this.arenaWidthPx > 0 && this.arenaHeightPx > 0) {
      cam.setBounds(0, 0, this.arenaWidthPx, this.arenaHeightPx)
    } else {
      this.log.warn(
        { event: "arena.visual.bounds.skipped", reason: "zero_size_visual" },
        "Arena visual has zero size; camera bounds not set",
      )
    }
  }

  /**
   * Creates the minimap camera and DOM frame after world visuals exist.
   */
  private _setupMinimap(): void {
    this.minimapController = new MinimapController(this.scene, {
      arenaWidth: this.arenaWidthPx,
      arenaHeight: this.arenaHeightPx,
    })
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.minimapController?.destroy()
    })
  }

  /**
   * Initialises audio subsystems.
   */
  private _setupAudio(): void {
    this.soundManager = new SoundManager(this.scene)
    this.walkFootstep = new WalkFootstepController(this.soundManager, () =>
      this.playerRenderSystem.localPlayerId,
    )
    this.bgmPlayer = new BgmPlayer(this.scene)
    this.bgmPlayer.startBattleMusic()
  }

  /**
   * Opens the Colyseus game room connection and subscribes to all room events.
   * Prefers the React-injected `GameConnection` from the game registry (single session).
   * Falls back to `connect()` only when no injection exists (e.g. isolated tests / non-Next boot).
   */
  private _openConnection(): void {
    const injected = this.scene.game.registry.get(WW_GAME_CONNECTION_REGISTRY_KEY) as
      | GameConnection
      | undefined

    if (injected?.room) {
      this.connection = injected
      this.ownsConnection = false
      this.log.info(
        { event: "arena.connection.injected", roomId: injected.room.roomId, sessionId: injected.room.sessionId },
        "Using injected game connection",
      )
      const sub = this.scene.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
        | string
        | undefined
      this.playerRenderSystem.localPlayerId = sub ?? null
      this.networkSyncSystem.localPlayerId = sub ?? null
      this._subscribeRoomEvents()
      this.connection.sendClientSceneReady()
      this.log.info({ event: "arena.scene_ready.sent", playerId: sub }, "Client scene ready sent")
      return
    }

    this.connection = new GameConnection()
    this.ownsConnection = true
    this.log.info(
      { event: "arena.connection.fallback", reason: "missing_injected_connection" },
      "Opening fallback game connection",
    )
    const sub = this.scene.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
      | string
      | undefined
    this.playerRenderSystem.localPlayerId = sub ?? null
    this.networkSyncSystem.localPlayerId = sub ?? null
    void this.connection.connect().then(() => {
      if (this.destroyed) {
        void this.connection.close()
        return
      }
      this._subscribeRoomEvents()
      this.connection.sendClientSceneReady()
      this.log.info({ event: "arena.scene_ready.sent", playerId: sub }, "Client scene ready sent")
    })
  }

  /**
   * Subscribes all relevant room message handlers to the active connection.
   */
  private _subscribeRoomEvents(): void {
    this.connectionUnsub?.()
    const generation = this.messageGeneration
    this.connectionUnsub = this.connection.onMessage((message) => {
      if (this.destroyed || generation !== this.messageGeneration) return
      switch (message.type) {
        case WsEvent.GameStateSync: {
          const payload = message.payload as GameStateSyncPayload
          this._applyInputProtocol(payload.input, payload.inputStreamReset === true)
          this.networkSyncSystem.applyFullSync(payload)
          this.playerRenderSystem.applyFullSync(payload)
          this.projectileRenderSystem.applyFullSyncFireballs(
            payload.fireballs,
            payload.serverTimeMs,
          )
          this.projectileRenderSystem.applyFullSyncHomingOrbs(
            payload.homingOrbs ?? [],
            payload.serverTimeMs,
          )
          this.combatTelegraphRenderSystem.applyFullSync(payload.activeTelegraphs ?? [])
          this._ensureMatchLive()
          break
        }
        case WsEvent.PlayerBatchUpdate:
          this.networkSyncSystem.applyBatchUpdate(message.payload as PlayerBatchUpdatePayload)
          break
        case WsEvent.PlayerOwnerAck:
          this.networkSyncSystem.applyOwnerAck(message.payload as PlayerOwnerAckPayload)
          break
        case WsEvent.FireballLaunch:
          this.projectileRenderSystem.spawnFireball(message.payload as FireballLaunchPayload)
          this.soundManager.play(SFX_KEYS.fireballCast)
          break
        case WsEvent.FireballBatchUpdate:
          this.projectileRenderSystem.applyBatchUpdate(message.payload as FireballBatchUpdatePayload)
          break
        case WsEvent.FireballImpact: {
          const payload = message.payload as FireballImpactPayload
          this.projectileRenderSystem.destroyFireball(payload.id)
          this.soundManager.play(SFX_KEYS.fireballImpact)
          break
        }
        case WsEvent.HomingOrbLaunch:
          this.projectileRenderSystem.spawnHomingOrb(message.payload as HomingOrbLaunchPayload)
          this.soundManager.play(SFX_KEYS.homingOrbCast)
          break
        case WsEvent.HomingOrbBatchUpdate:
          this.projectileRenderSystem.applyHomingOrbBatchUpdate(
            message.payload as HomingOrbBatchUpdatePayload,
          )
          break
        case WsEvent.HomingOrbImpact: {
          const payload = message.payload as HomingOrbImpactPayload
          this.projectileRenderSystem.destroyHomingOrb(payload.id)
          this.soundManager.play(
            payload.reason === "expired" ? SFX_KEYS.homingOrbExpire : SFX_KEYS.homingOrbImpact,
          )
          break
        }
        case WsEvent.LightningBolt:
          this.lightningBoltRenderSystem.spawnBolt(message.payload as LightningBoltPayload)
          this.soundManager.play(SFX_KEYS.lightningCast)
          break
        case WsEvent.PrimaryMeleeAttack: {
          const payload = message.payload as PrimaryMeleeAttackPayload
          this.playerRenderSystem.onPrimaryMeleeSwing(payload)
          this.soundManager.play(SFX_KEYS.axeSwing)
          break
        }
        case WsEvent.CombatTelegraphStart:
          this.combatTelegraphRenderSystem.start(
            message.payload as CombatTelegraphStartPayload,
          )
          break
        case WsEvent.CombatTelegraphEnd:
          this.combatTelegraphRenderSystem.end(
            message.payload as CombatTelegraphEndPayload,
          )
          break
        case WsEvent.AbilitySfx:
          this.soundManager.play((message.payload as AbilitySfxPayload).sfxKey)
          break
        case WsEvent.PlayerDeath:
          this.playerRenderSystem.onPlayerDeath(message.payload as PlayerDeathPayload)
          this.soundManager.play(SFX_KEYS.playerDeath)
          break
        case WsEvent.PlayerRespawn:
          this.playerRenderSystem.onPlayerRespawn(message.payload as PlayerRespawnPayload)
          break
        case WsEvent.DamageFloat: {
          const payload = message.payload as DamageFloatPayload
          this.damageFloatersSystem.spawn(payload)
          const decision = resolveDamageFloatLocalFeedback(
            this.playerRenderSystem.localPlayerId,
            payload,
            Date.now(),
            this.lastHazardTakeHitSfxAtMs,
          )
          this.lastHazardTakeHitSfxAtMs = decision.nextLastHazardTakeHitSfxAtMs
          if (decision.flashVictimUserId) {
            this.playerRenderSystem.triggerHitFeedbackFlashForPlayerUserId(
              decision.flashVictimUserId,
            )
          }
          if (decision.flashDealerUserId) {
            this.playerRenderSystem.triggerHitFeedbackFlashForPlayerUserId(
              decision.flashDealerUserId,
            )
          }
          if (decision.playTakeHitSfx) {
            this.soundManager.playRestarting(SFX_KEYS.hitTaken)
          }
          if (decision.playDealSfx) {
            this.soundManager.play(SFX_KEYS.hitDeal)
          }
          break
        }
        case WsEvent.MatchGo:
          this._onMatchGo(message.payload as MatchGoPayload)
          break
      }
    })

    if (this.connection.isMatchInProgress()) {
      this.log.info(
        { event: "arena.resync.requested", roomId: this.connection.room?.roomId },
        "Requesting match resync after subscription",
      )
      this.connection.sendRequestResync()
    }
  }

  /**
   * Marks the arena as live and enables input. Idempotent; used after
   * `MatchGo` and after `GameStateSync` (e.g. refresh / resync).
   */
  private _ensureMatchLive(): void {
    if (!this.matchStarted) {
      this.log.info(
        { event: "arena.match.live", roomId: this.connection.room?.roomId },
        "Arena match marked live",
      )
    }
    this.matchStarted = true
    this.keyboardController.enable()
    this.mouseController.enable()
  }

  /**
   * Called when the server signals the match has started (MatchGo).
   */
  private _onMatchGo(payload?: MatchGoPayload): void {
    this._applyInputProtocol(payload?.input)
    if (payload?.timing) {
      this.playerRenderSystem.applyNetTiming(payload.timing)
      this.projectileRenderSystem.applyNetTiming?.(payload.timing)
    }
    this._ensureMatchLive()
  }

  /**
   * Applies user-facing audio volume settings to the active audio managers.
   *
   * @param settings - Optional BGM/SFX volume values in 0-100 units.
   */
  setAudioVolumes(settings: {
    readonly bgmVolume?: number
    readonly sfxVolume?: number
  }): void {
    if (settings.bgmVolume !== undefined) {
      this.bgmPlayer.setMasterBgmVolume(settings.bgmVolume)
    }
    if (settings.sfxVolume !== undefined) {
      this.soundManager.setMasterSfxVolume(settings.sfxVolume)
    }
  }

  /**
   * Enables or disables local-only debug overlays.
   *
   * @param enabled - Whether debug geometry should be drawn on this client.
   */
  setDebugModeEnabled(enabled: boolean): void {
    this.debugOverlaySystem?.setEnabled(enabled)
  }

  /**
   * Applies compact minimap placement from user settings.
   *
   * @param corner - Compact minimap corner.
   */
  setMinimapCorner(corner: MinimapCorner): void {
    this.minimapController?.setCorner(corner)
  }

  /**
   * Main game loop update. Runs all ECS systems each frame.
   *
   * @param _time - Absolute time in ms (unused directly).
   * @param delta - Frame delta time in ms.
   */
  update(_time: number, delta: number): void {
    if (!this.matchStarted) return

    const localMoveIntent = this.connection.isConnected()
      ? this.keyboardController.collectMoveIntent()
      : INACTIVE_MOVE_INTENT

    // Run one local send per committed prediction tick (fixed 60 Hz),
    // not per render frame. Threading the callback through
    // `PlayerRenderSystem.update` keeps the accumulator + sim + send
    // loop synchronized inside a single system boundary.
    this.playerRenderSystem.update(delta, localMoveIntent, (fullInput) => {
      if (!fullInput) return
      if (!this.connection.isConnected()) return
      const resolvedAbilityId =
        this.playerRenderSystem.resolveLocalAbilityIdForInput(fullInput)
      this.playerRenderSystem.localInputHistory.append(fullInput, {
        resolvedAbilityId,
      })
      if (this.inputTransport === "compact") {
        const state = this.compactInputScheduler.maybeBuildState(
          fullInput,
          fullInput.clientSendTimeMs,
        )
        if (state) this.connection.sendPlayerInputState(state)
      } else {
        this.connection.sendPlayerInput(fullInput)
      }
      if (isActiveLocalInput(fullInput)) {
        this.activeLocalInputHandler?.()
      }
    }, (): PlayerInputPayload | null => {
      if (!this.connection.isConnected()) return null
      const keyboardInput = this.keyboardController.collectInput(
        this.connection.nextSeq(),
      )
      const mouseInput = this.mouseController.collectInput()
      return {
        ...keyboardInput,
        ...mouseInput,
        ...stampClientSendTime(),
      }
    })
    this.walkFootstep.tick(delta, localMoveIntent)
    this.debugOverlaySystem.update()
    this.projectileRenderSystem.update(delta)
    this.combatTelegraphRenderSystem.update(
      this.playerRenderSystem.getEstimatedServerTimeMs(),
    )
    this.lightningBoltRenderSystem.update(delta)
    this.damageFloatersSystem.update(delta)

    const local = this.playerRenderSystem.getLocalPlayerRenderPos()
    if (local) {
      this.scene.cameras.main.centerOn(local.x, local.y)
    }
    this.minimapController.update()
  }

  /**
   * Applies server-advertised input transport settings, defaulting to legacy
   * when old servers omit the capability payload.
   *
   * @param protocol - Optional input protocol from `MatchGo` or `GameStateSync`.
   * @param resetInputState - True when the server reset this client's input stream.
   */
  private _applyInputProtocol(
    protocol?: GameInputProtocolPayload,
    resetInputState = false,
  ): void {
    const nextTransport =
      protocol?.preferredTransport === "compact" ? "compact" : "legacy"
    const nextConfigKey = [
      nextTransport,
      protocol?.activeHeartbeatMs ?? "",
      protocol?.idleHeartbeatMs ?? "",
    ].join(":")

    if (!resetInputState && this.inputProtocolConfigKey === nextConfigKey) return

    this.inputTransport = nextTransport
    this.inputProtocolConfigKey = nextConfigKey
    this.compactInputScheduler = new PlayerInputStateScheduler({
      activeHeartbeatMs: protocol?.activeHeartbeatMs,
      idleHeartbeatMs: protocol?.idleHeartbeatMs,
    })
  }

  /**
   * Exposes the GameConnection for use by input controllers and HUD.
   *
   * @returns The active GameConnection instance.
   */
  getConnection(): GameConnection {
    return this.connection
  }

  /**
   * Exposes the local user's auth id (JWT `sub`); matches `playerId` in sync payloads.
   *
   * @returns The player id from registry, or null if not set.
   */
  getLocalPlayerId(): string | null {
    const sub = this.scene.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
      | string
      | undefined
    return sub ?? null
  }

  /**
   * Releases runtime-owned resources that outlive Phaser scene teardown.
   *
   * The lobby keeps a shared {@link GameConnection} alive while navigating
   * between lobby and game routes, so each Arena scene must remove only its own
   * room handler. Also destroys ECS-backed render state ({@link PlayerRenderSystem},
   * {@link CombatTelegraphRenderSystem}) so sprites do not outlive the scene when the
   * connection is reused. This method is intentionally idempotent because Phaser can
   * emit multiple teardown events during game destruction.
   */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.messageGeneration++

    this.connectionUnsub?.()
    this.connectionUnsub = undefined
    this.playerRenderSystem?.destroy()
    this.combatTelegraphRenderSystem?.destroy()

    if (this.ownsConnection) {
      void this.connection?.close()
    }
  }
}
