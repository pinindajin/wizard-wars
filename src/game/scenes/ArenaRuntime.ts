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
import { registerFireballAnims } from "../animation/FireballAnimDefs"
import { BgmPlayer } from "../audio/BgmPlayer"
import { SoundManager } from "../audio/SoundManager"

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

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly visuals: ArenaRuntimeVisuals,
  ) {}

  /**
   * Starts the same systems previously created by Arena.editorCreate(), after
   * Phaser Editor has created the visual tilemap.
   */
  start(): void {
    this._configureTilemap()
    this._createPlayerGroup()
    this._createSystems()
    this._setupCamera()
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
    this.axeSwingRenderSystem = new AxeSwingRenderSystem(this.scene)
    this.damageFloatersSystem = new DamageFloatersSystem(this.scene)
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
      console.warn("[Arena] Tilemap has zero size; camera bounds not set.")
    }
  }

  /**
   * Initialises audio subsystems.
   */
  private _setupAudio(): void {
    this.soundManager = new SoundManager(this.scene)
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
      const sub = this.scene.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
        | string
        | undefined
      this.playerRenderSystem.localPlayerId = sub ?? null
      this.networkSyncSystem.localPlayerId = sub ?? null
      this._subscribeRoomEvents()
      this.connection.sendClientSceneReady()
      return
    }

    this.connection = new GameConnection()
    const sub = this.scene.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
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
    this.projectileRenderSystem.update(delta)
    this.lightningBoltRenderSystem.update(delta)
    this.axeSwingRenderSystem.update(delta)
    this.damageFloatersSystem.update(delta)

    const local = this.playerRenderSystem.getLocalPlayerRenderPos()
    if (local) {
      this.scene.cameras.main.centerOn(local.x, local.y)
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
    const sub = this.scene.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as
      | string
      | undefined
    return sub ?? null
  }
}
