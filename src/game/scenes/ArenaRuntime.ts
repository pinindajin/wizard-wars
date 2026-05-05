import Phaser from "phaser"

import { clientLogger } from "@/lib/clientLogger"
import { WsEvent } from "@/shared/events"
import { ARENA_CAMERA_FOLLOW_ZOOM, TILEMAP_DEPTH } from "@/shared/balance-config/rendering"
import type {
  GameStateSyncPayload,
  PlayerBatchUpdatePayload,
  FireballLaunchPayload,
  FireballBatchUpdatePayload,
  FireballImpactPayload,
  LightningBoltPayload,
  PrimaryMeleeAttackPayload,
  CombatTelegraphStartPayload,
  CombatTelegraphEndPayload,
  PlayerDeathPayload,
  PlayerRespawnPayload,
  DamageFloatPayload,
  AbilitySfxPayload,
} from "@/shared/types"
import {
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_DEBUG_MODE_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
} from "../constants"
import type { MinimapCorner } from "@/shared/settings-config"
import { GameConnection } from "../network/GameConnection"
import { PlayerRenderSystem } from "../ecs/systems/PlayerRenderSystem"
import { ProjectileRenderSystem } from "../ecs/systems/ProjectileRenderSystem"
import { LightningBoltRenderSystem } from "../ecs/systems/LightningBoltRenderSystem"
import { CombatTelegraphRenderSystem } from "../ecs/systems/CombatTelegraphRenderSystem"
import { DamageFloatersSystem } from "../ecs/systems/DamageFloatersSystem"
import { DebugOverlaySystem } from "../ecs/systems/DebugOverlaySystem"
import { NetworkSyncSystem } from "../ecs/systems/NetworkSyncSystem"
import { KeyboardController } from "../input/KeyboardController"
import { MouseController } from "../input/MouseController"
import { registerLadyWizardAnims } from "../animation/LadyWizardAnimDefs"
import { registerFireballAnims } from "../animation/FireballAnimDefs"
import { SFX_KEYS } from "@/shared/balance-config/audio"
import { resolveDamageFloatLocalFeedback } from "../hitFeedback/damageFloatLocalFeedback"
import { BgmPlayer } from "../audio/BgmPlayer"
import { SoundManager } from "../audio/SoundManager"
import { WalkFootstepController } from "../audio/WalkFootstepController"
import { MinimapController } from "../minimap/MinimapController"

type ArenaRuntimeVisuals = {
  arenaMap: Phaser.Tilemaps.Tilemap
}

const INACTIVE_PLAYER_INPUT = {
  up: false,
  down: false,
  left: false,
  right: false,
  abilitySlot: null,
  abilityTargetX: 0,
  abilityTargetY: 0,
  useQuickItemSlot: null,
  seq: 0,
} as const

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

  /** Whether the match has started (MatchGo received). */
  private matchStarted = false

  /**
   * Wall clock (ms) when hazard take-hit SFX last played; used to throttle
   * environmental damage grunts only.
   */
  private lastHazardTakeHitSfxAtMs: number | null = null

  /** Pixel size of the loaded arena tilemap (for camera bounds). */
  private arenaWidthPx = 0
  private arenaHeightPx = 0

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly visuals: ArenaRuntimeVisuals,
  ) {}

  /**
   * Starts the same systems previously created by Arena.editorCreate(), after
   * Phaser Editor has created the visual tilemap.
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
    registerLadyWizardAnims(this.scene.anims)
    registerFireballAnims(this.scene.anims)
    this._openConnection()
  }

  /**
   * Applies current runtime tilemap behavior to the editor-created map.
   */
  private _configureTilemap(): void {
    const map = this.visuals.arenaMap
    this.arenaWidthPx = map.widthInPixels
    this.arenaHeightPx = map.heightInPixels

    for (const [index, layer] of map.layers.entries()) {
      layer.tilemapLayer?.setDepth(TILEMAP_DEPTH + index)
    }
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
        })
      },
      onServerTime: (serverTimeMs) => {
        this.playerRenderSystem.updateServerTimeOffset(serverTimeMs)
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
   * Configures the main camera: world bounds from the arena tilemap, follow zoom
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
        { event: "arena.tilemap.bounds.skipped", reason: "zero_size_tilemap" },
        "Tilemap has zero size; camera bounds not set",
      )
    }
  }

  /**
   * Creates the minimap camera and DOM frame after world visuals exist.
   */
  private _setupMinimap(): void {
    this.minimapController = new MinimapController(this.scene, this.visuals.arenaMap)
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
          this.networkSyncSystem.applyFullSync(payload)
          this.playerRenderSystem.applyFullSync(payload)
          this.projectileRenderSystem.applyFullSyncFireballs(payload.fireballs)
          this.combatTelegraphRenderSystem.applyFullSync(payload.activeTelegraphs ?? [])
          this._ensureMatchLive()
          break
        }
        case WsEvent.PlayerBatchUpdate:
          this.networkSyncSystem.applyBatchUpdate(message.payload as PlayerBatchUpdatePayload)
          break
        case WsEvent.FireballLaunch:
          this.projectileRenderSystem.spawnFireball(message.payload as FireballLaunchPayload)
          break
        case WsEvent.FireballBatchUpdate:
          this.projectileRenderSystem.applyBatchUpdate(message.payload as FireballBatchUpdatePayload)
          break
        case WsEvent.FireballImpact: {
          const payload = message.payload as FireballImpactPayload
          this.projectileRenderSystem.destroyFireball(payload.id)
          this.soundManager.play("sfx-fireball-impact")
          break
        }
        case WsEvent.LightningBolt:
          this.lightningBoltRenderSystem.spawnBolt(message.payload as LightningBoltPayload)
          this.soundManager.play("sfx-lightning-cast")
          break
        case WsEvent.PrimaryMeleeAttack: {
          const payload = message.payload as PrimaryMeleeAttackPayload
          this.playerRenderSystem.onPrimaryMeleeSwing(payload)
          this.soundManager.play("sfx-axe-swing")
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
          this.soundManager.play("sfx-player-death")
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
          this._onMatchGo()
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
  private _onMatchGo(): void {
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

    const keyboardInput = this.connection.isConnected()
      ? this.keyboardController.collectInput(this.connection.nextSeq())
      : INACTIVE_PLAYER_INPUT

    // Run one local send per committed prediction tick (fixed 60 Hz),
    // not per render frame. Threading the callback through
    // `PlayerRenderSystem.update` keeps the accumulator + sim + send
    // loop synchronized inside a single system boundary.
    this.playerRenderSystem.update(delta, keyboardInput, () => {
      if (!this.connection.isConnected()) return
      const mouseInput = this.mouseController.collectInput()
      const fullInput = {
        ...keyboardInput,
        ...mouseInput,
        ...stampClientSendTime(),
      }
      this.playerRenderSystem.localInputHistory.append(fullInput)
      this.connection.sendPlayerInput(fullInput)
    })
    this.walkFootstep.tick(delta, keyboardInput)
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
