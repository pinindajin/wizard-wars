import Phaser from "phaser"

import { RoomEvent } from "@/shared/roomEvents"
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
  MatchGoPayload,
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
    const room = this.connection.room
    if (!room) return

    room.onMessage(RoomEvent.GameStateSync, (payload: GameStateSyncPayload) => {
      this.networkSyncSystem.applyFullSync(payload)
      this.playerRenderSystem.applyFullSync(payload)
    })

    room.onMessage(RoomEvent.PlayerBatchUpdate, (payload: PlayerBatchUpdatePayload) => {
      this.networkSyncSystem.applyBatchUpdate(payload)
    })

    room.onMessage(RoomEvent.FireballLaunch, (payload: FireballLaunchPayload) => {
      this.projectileRenderSystem.spawnFireball(payload)
    })

    room.onMessage(RoomEvent.FireballBatchUpdate, (payload: FireballBatchUpdatePayload) => {
      this.projectileRenderSystem.applyBatchUpdate(payload)
    })

    room.onMessage(RoomEvent.FireballImpact, (payload: FireballImpactPayload) => {
      this.projectileRenderSystem.destroyFireball(payload.id)
      this.soundManager.play("sfx-fireball-impact")
    })

    room.onMessage(RoomEvent.LightningBolt, (payload: LightningBoltPayload) => {
      this.lightningBoltRenderSystem.spawnBolt(payload)
      this.soundManager.play("sfx-lightning-cast")
    })

    room.onMessage(RoomEvent.AxeSwing, (payload: AxeSwingPayload) => {
      this.axeSwingRenderSystem.spawnSwing(payload)
      this.soundManager.play("sfx-axe-swing")
    })

    room.onMessage(RoomEvent.PlayerDeath, (payload: PlayerDeathPayload) => {
      this.playerRenderSystem.onPlayerDeath(payload)
      this.soundManager.play("sfx-player-death")
    })

    room.onMessage(RoomEvent.PlayerRespawn, (payload: PlayerRespawnPayload) => {
      this.playerRenderSystem.onPlayerRespawn(payload)
    })

    room.onMessage(RoomEvent.DamageFloat, (payload: DamageFloatPayload) => {
      this.damageFloatersSystem.spawn(payload)
    })

    room.onMessage(RoomEvent.MatchGo, (_payload: MatchGoPayload) => {
      this._onMatchGo()
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

    if (this.connection.room) {
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
    return this.connection.room?.sessionId ?? null
  }
}
