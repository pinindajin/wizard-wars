import type { GameStateSyncPayload, PlayerBatchUpdatePayload } from "@/shared/types"
import {
  ClientPosition,
  ClientPlayerState,
} from "../components"
import { addEntity, hasEntity, clientEntities, removeEntity } from "../world"

type AuthoritativePositionReason = "full_sync" | "batch_update"

/**
 * Opaque sample passed to {@link NetworkSyncHooks.onRemoteSnapshot} when a
 * batch update contains fields useful for remote interpolation
 * (position + velocity + facing angles).
 */
export type RemoteSnapshotSample = {
  readonly id: number
  readonly serverTimeMs: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly facingAngle: number
  readonly moveFacingAngle: number
}

/** ACK info extracted from a batch delta for the local player. */
export type LocalAckSample = {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly lastProcessedInputSeq: number
}

type NetworkSyncHooks = {
  readonly onBatchReceived?: () => void
  readonly onAuthoritativePosition?: (id: number, x: number, y: number, reason: AuthoritativePositionReason) => void
  /** Called once per remote delta with position & velocity for interpolation. */
  readonly onRemoteSnapshot?: (sample: RemoteSnapshotSample) => void
  /** Called when a batch delivers a new `lastProcessedInputSeq` for the local player. */
  readonly onLocalAck?: (sample: LocalAckSample) => void
  /**
   * Called on every authoritative batch (and full sync) with the server
   * wall-clock time so the client can maintain a clock offset.
   */
  readonly onServerTime?: (serverTimeMs: number) => void
}

/**
 * Applies authoritative server state updates to the client ECS component records.
 * Routes remote vs local snapshots to their respective rendering subsystems
 * via the provided hooks.
 */
export class NetworkSyncSystem {
  private readonly onBatchReceived?: () => void
  private readonly onAuthoritativePositionHook?: NetworkSyncHooks["onAuthoritativePosition"]
  private readonly onRemoteSnapshot?: NetworkSyncHooks["onRemoteSnapshot"]
  private readonly onLocalAck?: NetworkSyncHooks["onLocalAck"]
  private readonly onServerTime?: NetworkSyncHooks["onServerTime"]

  /** Set by Arena once the local playerId is known; used to route acks. */
  localPlayerId: string | null = null

  /** Last ACKed `lastProcessedInputSeq` observed per player. */
  private readonly lastAckByPlayer = new Map<string, number>()

  /**
   * @param hooks - Optional render hooks that track authoritative position changes.
   */
  constructor(hooks: NetworkSyncHooks = {}) {
    this.onBatchReceived = hooks.onBatchReceived
    this.onAuthoritativePositionHook = hooks.onAuthoritativePosition
    this.onRemoteSnapshot = hooks.onRemoteSnapshot
    this.onLocalAck = hooks.onLocalAck
    this.onServerTime = hooks.onServerTime
  }

  /**
   * Replaces all client entity state with the full server snapshot.
   * Used on connect or reconnect.
   *
   * @param payload - Full game state from the server.
   */
  applyFullSync(payload: GameStateSyncPayload): void {
    this.onServerTime?.(payload.serverTimeMs)
    const keep = new Set(payload.players.map((p) => p.id))
    for (const id of [...clientEntities]) {
      if (!keep.has(id)) {
        removeEntity(id)
        delete ClientPosition[id]
        delete ClientPlayerState[id]
      }
    }
    for (const snap of payload.players) {
      if (!hasEntity(snap.id)) {
        addEntity(snap.id)
      }
      ClientPosition[snap.id] = { x: snap.x, y: snap.y }
      this.onAuthoritativePositionHook?.(snap.id, snap.x, snap.y, "full_sync")
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
      this.lastAckByPlayer.set(snap.playerId, snap.lastProcessedInputSeq)
    }
  }

  /**
   * Merges a partial batch update into existing component records.
   * Only fields present in the delta are updated. Routes remote snapshots
   * and local acks to the configured hooks.
   *
   * @param payload - Batch delta update from the server.
   */
  applyBatchUpdate(payload: PlayerBatchUpdatePayload): void {
    if (payload.deltas.length > 0) {
      this.onBatchReceived?.()
    }
    this.onServerTime?.(payload.serverTimeMs)

    for (const delta of payload.deltas) {
      const pos = ClientPosition[delta.id]
      const state = ClientPlayerState[delta.id]

      let nextX = pos?.x
      let nextY = pos?.y

      if (delta.x !== undefined || delta.y !== undefined) {
        nextX = delta.x ?? pos?.x
        nextY = delta.y ?? pos?.y

        if (nextX !== undefined && nextY !== undefined) {
          if (pos) {
            pos.x = nextX
            pos.y = nextY
          } else {
            ClientPosition[delta.id] = { x: nextX, y: nextY }
          }
          this.onAuthoritativePositionHook?.(
            delta.id,
            nextX,
            nextY,
            "batch_update",
          )
        }
      }

      if (state) {
        if (delta.facingAngle !== undefined) state.facingAngle = delta.facingAngle
        if (delta.moveFacingAngle !== undefined) state.moveFacingAngle = delta.moveFacingAngle
        if (delta.health !== undefined) state.health = delta.health
        if (delta.lives !== undefined) state.lives = delta.lives
        if (delta.animState !== undefined) state.animState = delta.animState
        if (delta.castingAbilityId !== undefined) state.castingAbilityId = delta.castingAbilityId
        if (delta.invulnerable !== undefined) state.invulnerable = delta.invulnerable
      }

      // Remote vs local routing.
      const playerId = state?.playerId
      const isLocal = playerId !== undefined && playerId === this.localPlayerId

      if (
        !isLocal &&
        nextX !== undefined &&
        nextY !== undefined &&
        state !== undefined
      ) {
        this.onRemoteSnapshot?.({
          id: delta.id,
          serverTimeMs: payload.serverTimeMs,
          x: nextX,
          y: nextY,
          vx: delta.vx ?? 0,
          vy: delta.vy ?? 0,
          facingAngle: state.facingAngle,
          moveFacingAngle: state.moveFacingAngle,
        })
      }

      if (
        isLocal &&
        delta.lastProcessedInputSeq !== undefined &&
        nextX !== undefined &&
        nextY !== undefined
      ) {
        const prev = this.lastAckByPlayer.get(playerId!) ?? -1
        if (delta.lastProcessedInputSeq > prev) {
          this.lastAckByPlayer.set(playerId!, delta.lastProcessedInputSeq)
          this.onLocalAck?.({
            id: delta.id,
            x: nextX,
            y: nextY,
            lastProcessedInputSeq: delta.lastProcessedInputSeq,
          })
        }
      }
    }
  }
}
