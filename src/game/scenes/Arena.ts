import Phaser from "phaser"

import { WsEvent } from "@/shared/events"
import { TILEMAP_DEPTH } from "@/shared/balance-config/rendering"
import type {
  GameStateSyncPayload,
  PlayerBatchUpdatePayload,
  FireballLaunchPayload,
  FireballBatchUpdatePayload,
  FireballImpactPayload,
  LightningBoltPayload,
  AxeSwingPayload,
  PlayerDeathPayload,
  PlayerRespawnPayload,
  DamageFloatPayload,
} from "@/shared/types"
import { GameConnection } from "../network/GameConnection"
import { PlayerRenderSystem } from "../ecs/systems/PlayerRenderSystem"
import { ProjectileRenderSystem } from "../ecs/systems/ProjectileRenderSystem"
import { LightningBoltRenderSystem } from "../ecs/systems/LightningBoltRenderSystem"
import { AxeSwingRenderSystem } from "../ecs/systems/AxeSwingRenderSystem"
import { DamageFloatersSystem } from "../ecs/systems/DamageFloatersSystem"
import { NetworkSyncSystem } from "../ecs/systems/NetworkSyncSystem"
import { KeyboardController } from "../input/KeyboardController"
import { MouseController } from "../input/MouseController"
import { registerLadyWizardAnims } from "../animation/LadyWizardAnimDefs"
import { BgmPlayer } from "../audio/BgmPlayer"
import { SoundManager } from "../audio/SoundManager"

/**
 * Main arena gameplay scene.
 * Wires together the tilemap, ECS render systems, network connection, and input controllers.
 * Compatible with Phaser Editor 2D via the editorCreate() pattern.
 */
export class Arena extends Phaser.Scene {
  /** Phaser group used to collect all player sprites for iteration. */
  playerGroup!: Phaser.GameObjects.Group

  /** Active Colyseus room connection. */
  private connection!: GameConnection

  private playerRenderSystem!: PlayerRenderSystem
  private projectileRenderSystem!: ProjectileRenderSystem
  private lightningBoltRenderSystem!: LightningBoltRenderSystem
  private axeSwingRenderSystem!: AxeSwingRenderSystem
  private damageFloatersSystem!: DamageFloatersSystem
  private networkSyncSystem!: NetworkSyncSystem

  private keyboardController!: KeyboardController
  private mouseController!: MouseController

  private bgmPlayer!: BgmPlayer
  private soundManager!: SoundManager

  /** Whether the match has started (MatchGo received). */
  private matchStarted = false

  constructor() {
    super({ key: "Arena" })
  }

  preload(): void {
    this.load.pack("arena-assets", "assets/packs/arena-asset-pack.json")
  }

  create(): void {
    this.editorCreate()
  }

  /**
   * Phaser Editor 2D compatible creation method.
   * Builds the tilemap, creates player group, wires all systems, and opens the network connection.
   */
  editorCreate(): void {
    this._buildTilemap()
    this._createPlayerGroup()
    this._createSystems()
    this._setupCamera()
    this._setupAudio()
    registerLadyWizardAnims(this.anims)
    this._openConnection()
  }

  /**
   * Builds the Tiled JSON tilemap and places it at depth TILEMAP_DEPTH.
   */
  private _buildTilemap(): void {
    const map = this.make.tilemap({ key: "arena" })
    const tileset = map.addTilesetImage("arena-terrain", "arena-terrain")
    if (tileset) {
      const groundLayer = map.createLayer("Ground", tileset, 0, 0)
      const decoLayer = map.createLayer("Decoration", tileset, 0, 0)
      groundLayer?.setDepth(TILEMAP_DEPTH)
      decoLayer?.setDepth(TILEMAP_DEPTH + 1)
    }
  }

  /**
   * Creates the Phaser Group that tracks all active player sprites.
   */
  private _createPlayerGroup(): void {
    this.playerGroup = this.add.group()
  }

  /**
   * Instantiates all ECS render and input systems.
   */
  private _createSystems(): void {
    this.networkSyncSystem = new NetworkSyncSystem()
    this.playerRenderSystem = new PlayerRenderSystem(this, this.playerGroup)
    this.projectileRenderSystem = new ProjectileRenderSystem(this)
    this.lightningBoltRenderSystem = new LightningBoltRenderSystem(this)
    this.axeSwingRenderSystem = new AxeSwingRenderSystem(this)
    this.damageFloatersSystem = new DamageFloatersSystem(this)
    this.keyboardController = new KeyboardController(this)
    this.mouseController = new MouseController(this)
  }

  /**
   * Configures the main camera: static (no follow), zoom 1.
   */
  private _setupCamera(): void {
    this.cameras.main.setZoom(1)
    this.cameras.main.setScroll(0, 0)
  }

  /**
   * Initialises audio subsystems.
   */
  private _setupAudio(): void {
    this.soundManager = new SoundManager(this)
    this.bgmPlayer = new BgmPlayer(this)
    this.bgmPlayer.startBattleMusic()
  }

  /**
   * Opens the Colyseus game room connection and subscribes to all room events.
   */
  private _openConnection(): void {
    this.connection = new GameConnection()
    void this.connection.connect().then(() => {
      this._subscribeRoomEvents()
      this.connection.sendClientSceneReady()
    })
  }

  /**
   * Subscribes all relevant room message handlers to the active connection.
   */
  private _subscribeRoomEvents(): void {
    this.connection.onMessage((message) => {
      switch (message.type) {
        case WsEvent.GameStateSync: {
          const payload = message.payload as GameStateSyncPayload
          this.networkSyncSystem.applyFullSync(payload)
          this.playerRenderSystem.applyFullSync(payload)
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
        case WsEvent.AxeSwing:
          this.axeSwingRenderSystem.spawnSwing(message.payload as AxeSwingPayload)
          this.soundManager.play("sfx-axe-swing")
          break
        case WsEvent.PlayerDeath:
          this.playerRenderSystem.onPlayerDeath(message.payload as PlayerDeathPayload)
          this.soundManager.play("sfx-player-death")
          break
        case WsEvent.PlayerRespawn:
          this.playerRenderSystem.onPlayerRespawn(message.payload as PlayerRespawnPayload)
          break
        case WsEvent.DamageFloat:
          this.damageFloatersSystem.spawn(message.payload as DamageFloatPayload)
          break
        case WsEvent.MatchGo:
          this._onMatchGo()
          break
      }
    })
  }

  /**
   * Called when the server signals the match has started (MatchGo).
   * Enables player input controllers.
   */
  private _onMatchGo(): void {
    this.matchStarted = true
    this.keyboardController.enable()
    this.mouseController.enable()
  }

  /**
   * Main game loop update. Runs all ECS systems each frame.
   *
   * @param _time - Absolute time in ms (unused directly).
   * @param delta - Frame delta time in ms.
   */
  update(_time: number, delta: number): void {
    if (!this.matchStarted) return

    this.playerRenderSystem.update(delta)
    this.projectileRenderSystem.update(delta)
    this.lightningBoltRenderSystem.update(delta)
    this.axeSwingRenderSystem.update(delta)
    this.damageFloatersSystem.update(delta)

    if (this.connection.isConnected()) {
      const input = this.keyboardController.collectInput(this.connection.nextSeq())
      const mouseInput = this.mouseController.collectInput()
      this.connection.sendPlayerInput({ ...input, ...mouseInput })
    }
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
   * Exposes the local player id (Colyseus sessionId) for systems that need it.
   *
   * @returns The session id string or null if not yet connected.
   */
  getLocalPlayerId(): string | null {
    return this.connection.sessionId ?? null
  }
}
