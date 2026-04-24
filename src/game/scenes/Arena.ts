import Phaser from "phaser"

import { WsEvent } from "@/shared/events"
import { ARENA_CAMERA_FOLLOW_ZOOM, TILEMAP_DEPTH } from "@/shared/balance-config/rendering"
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
import {
  WW_GAME_CONNECTION_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
} from "../constants"
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
import {
  publishLoaderComplete,
  wireSceneLoaderProgress,
} from "../loaderStatus"

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
 * this stamp at the scene-level (not inside controllers) preserves
 * controller testability.
 */
function stampClientSendTime(): { clientSendTimeMs: number } {
  return { clientSendTimeMs: Date.now() }
}

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

  /** Pixel size of the loaded arena tilemap (for camera bounds). */
  private arenaWidthPx = 0
  private arenaHeightPx = 0

  constructor() {
    super({ key: "Arena" })
  }

  preload(): void {
    this.load.pack("arena-assets", "/assets/arena-asset-pack.json")
    wireSceneLoaderProgress(this, {
      scene: "Arena",
      description: "Arena assets",
    })
  }

  create(): void {
    this.editorCreate()
    publishLoaderComplete(this.game as unknown as Parameters<typeof publishLoaderComplete>[0])
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
    this.arenaWidthPx = map.widthInPixels
    this.arenaHeightPx = map.heightInPixels
    const tileset = map.addTilesetImage("arena-terrain", "arena-terrain")
    if (!tileset) {
      console.warn(
        "[Arena] Tileset `arena-terrain` not loaded — check asset pack and public/assets path (Ground/Decoration layers skipped).",
      )
      return
    }
    const groundLayer = map.createLayer("Ground", tileset, 0, 0)
    const decoLayer = map.createLayer("Decoration", tileset, 0, 0)
    groundLayer?.setDepth(TILEMAP_DEPTH)
    decoLayer?.setDepth(TILEMAP_DEPTH + 1)
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
    this.playerRenderSystem = new PlayerRenderSystem(this, this.playerGroup)
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
    this.projectileRenderSystem = new ProjectileRenderSystem(this)
    this.lightningBoltRenderSystem = new LightningBoltRenderSystem(this)
    this.axeSwingRenderSystem = new AxeSwingRenderSystem(this)
    this.damageFloatersSystem = new DamageFloatersSystem(this)
    this.keyboardController = new KeyboardController(this)
    this.mouseController = new MouseController(this)
  }

  /**
   * Configures the main camera: world bounds from the arena tilemap, follow zoom
   * ({@link ARENA_CAMERA_FOLLOW_ZOOM}) so `centerOn` can scroll. Each frame, `update`
   * centers on the local player’s foot when available.
   */
  private _setupCamera(): void {
    const cam = this.cameras.main
    cam.setZoom(ARENA_CAMERA_FOLLOW_ZOOM)
    cam.setRoundPixels(true)
    if (this.arenaWidthPx > 0 && this.arenaHeightPx > 0) {
      cam.setBounds(0, 0, this.arenaWidthPx, this.arenaHeightPx)
    } else {
      console.warn("[Arena] Tilemap has zero size; camera bounds not set.")
    }
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
   * Prefers the React-injected `GameConnection` from the game registry (single session).
   * Falls back to `connect()` only when no injection exists (e.g. isolated tests / non-Next boot).
   */
  private _openConnection(): void {
    const injected = this.game.registry.get(WW_GAME_CONNECTION_REGISTRY_KEY) as
      | GameConnection
      | undefined

    if (injected?.room) {
      this.connection = injected
      const sub = this.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
        | string
        | undefined
      this.playerRenderSystem.localPlayerId = sub ?? null
      this.networkSyncSystem.localPlayerId = sub ?? null
      this._subscribeRoomEvents()
      this.connection.sendClientSceneReady()
      return
    }

    this.connection = new GameConnection()
    const sub = this.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
      | string
      | undefined
    this.playerRenderSystem.localPlayerId = sub ?? null
    this.networkSyncSystem.localPlayerId = sub ?? null
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
          this.projectileRenderSystem.applyFullSyncFireballs(payload.fireballs)
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

    if (this.connection.isMatchInProgress()) {
      this.connection.sendRequestResync()
    }
  }

  /**
   * Marks the arena as live and enables input. Idempotent; used after
   * `MatchGo` and after `GameStateSync` (e.g. refresh / resync).
   */
  private _ensureMatchLive(): void {
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

    this.playerRenderSystem.update(delta, keyboardInput)
    this.projectileRenderSystem.update(delta)
    this.lightningBoltRenderSystem.update(delta)
    this.axeSwingRenderSystem.update(delta)
    this.damageFloatersSystem.update(delta)

    if (this.connection.isConnected()) {
      const mouseInput = this.mouseController.collectInput()
      const fullInput = {
        ...keyboardInput,
        ...mouseInput,
        ...stampClientSendTime(),
      }
      this.playerRenderSystem.localInputHistory.append(fullInput)
      this.connection.sendPlayerInput(fullInput)
    }

    const local = this.playerRenderSystem.getLocalPlayerRenderPos()
    if (local) {
      this.cameras.main.centerOn(local.x, local.y)
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
   * Exposes the local user's auth id (JWT `sub`); matches `playerId` in sync payloads.
   *
   * @returns The player id from registry, or null if not set.
   */
  getLocalPlayerId(): string | null {
    const sub = this.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
      | string
      | undefined
    return sub ?? null
  }
}
