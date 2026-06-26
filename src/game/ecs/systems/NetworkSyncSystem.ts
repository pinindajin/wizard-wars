import type {
  GameNetTimingPayload,
  GameStateSyncPayload,
  PlayerBatchUpdatePayload,
  PlayerOwnerAckPayload,
} from "@/shared/types"
import { clientLogger } from "@/lib/clientLogger"
import {
  ClientPosition,
  ClientPlayerState,
} from "../components"
import { addEntity, hasEntity, clientEntities, removeEntity } from "../world"

type AuthoritativePositionReason = "full_sync" | "batch_update"
type PlayerDelta = PlayerBatchUpdatePayload["deltas"][number]

/**
 * Returns true when a player delta carries fields used by remote interpolation.
 *
 * Semantic-only deltas may still update ECS state, but they should not enqueue
 * a duplicate render sample at the previous position.
 *
 * @param delta - Player batch delta from the server.
 * @returns Whether the delta contains visual sample data.
 */
function hasRemoteVisualSample(delta: PlayerDelta): boolean {
  return (
    delta.x !== undefined ||
    delta.y !== undefined ||
    delta.vx !== undefined ||
    delta.vy !== undefined ||
    delta.facingAngle !== undefined ||
    delta.moveFacingAngle !== undefined
  )
}

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
  readonly vx?: number
  readonly vy?: number
  readonly lastProcessedInputSeq: number
  readonly replayContext?: PlayerOwnerAckPayload["replayContext"]
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
  /** Called when a full sync carries net timing for remote interpolation. */
  readonly onNetTiming?: (timing: GameNetTimingPayload | undefined) => void
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
  private readonly onNetTiming?: NetworkSyncHooks["onNetTiming"]
  private readonly log = clientLogger.child({ area: "netcode" })

  /** Set by Arena once the local playerId is known; used to route acks. */
  localPlayerId: string | null = null

  /** Last ACKed `lastProcessedInputSeq` observed per player. */
  private readonly lastAckByPlayer = new Map<string, number>()

  /** Players whose full-sync cursor `0` still needs the first real ACK `0`. */
  private readonly pendingFirstZeroAckByPlayer = new Set<string>()

  /**
   * @param hooks - Optional render hooks that track authoritative position changes.
   */
  constructor(hooks: NetworkSyncHooks = {}) {
    this.onBatchReceived = hooks.onBatchReceived
    this.onAuthoritativePositionHook = hooks.onAuthoritativePosition
    this.onRemoteSnapshot = hooks.onRemoteSnapshot
    this.onLocalAck = hooks.onLocalAck
    this.onServerTime = hooks.onServerTime
    this.onNetTiming = hooks.onNetTiming
  }

  /**
   * Replaces all client entity state with the full server snapshot.
   * Used on connect or reconnect.
   *
   * @param payload - Full game state from the server.
   */
  applyFullSync(payload: GameStateSyncPayload): void {
    this.onServerTime?.(payload.serverTimeMs)
    this.onNetTiming?.(payload.timing)
    const keep = new Set(payload.players.map((p) => p.id))
    let removedCount = 0
    for (const id of [...clientEntities]) {
      if (!keep.has(id)) {
        removeEntity(id)
        delete ClientPosition[id]
        delete ClientPlayerState[id]
        removedCount++
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
      this.lastAckByPlayer.set(snap.playerId, snap.lastProcessedInputSeq)
      if (snap.lastProcessedInputSeq === 0) {
        this.pendingFirstZeroAckByPlayer.add(snap.playerId)
      } else {
        this.pendingFirstZeroAckByPlayer.delete(snap.playerId)
      }
    }
    this.log.debug(
      {
        event: "net.sync.full.applied",
        playerCount: payload.players.length,
        fireballCount: payload.fireballs.length,
        removedCount,
        serverTimeMs: payload.serverTimeMs,
      },
      "Applied full game state sync",
    )
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
        if (delta.moveState !== undefined) state.moveState = delta.moveState
        if (delta.terrainState !== undefined) state.terrainState = delta.terrainState
        if (delta.castingAbilityId !== undefined) state.castingAbilityId = delta.castingAbilityId
        if (delta.invulnerable !== undefined) state.invulnerable = delta.invulnerable
        if (delta.jumpZ !== undefined) state.jumpZ = delta.jumpZ
        if (delta.jumpStartedInLava !== undefined) {
          state.jumpStartedInLava = delta.jumpStartedInLava
        }
        if (delta.hasSwiftBoots !== undefined) {
          state.hasSwiftBoots = delta.hasSwiftBoots
        }
        if (delta.abilityStates !== undefined) state.abilityStates = delta.abilityStates
      }
      if (!pos && (delta.x !== undefined || delta.y !== undefined)) {
        this.log.debug(
          {
            event: "net.sync.delta.missing_position",
            reason: "position_missing_before_delta",
            entityId: delta.id,
            seq: payload.seq,
          },
          "Batch delta created missing position",
        )
      }
      if (!state) {
        this.log.debug(
          {
            event: "net.sync.delta.missing_state",
            reason: "state_missing_before_delta",
            entityId: delta.id,
            seq: payload.seq,
          },
          "Batch delta referenced missing player state",
        )
      }

      // Remote vs local routing.
      const playerId = state?.playerId
      const isLocal = playerId !== undefined && playerId === this.localPlayerId

      if (
        !isLocal &&
        hasRemoteVisualSample(delta) &&
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
        if (
          this.acceptLocalAckCursor(
            playerId!,
            delta.lastProcessedInputSeq,
            "net.sync.ack.regressed",
            "Local input ack regressed",
          )
        ) {
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

  /**
   * Applies an owner-only ACK without mutating room-wide visual ECS state.
   *
   * @param payload - Dedicated server ACK for the local player.
   */
  applyOwnerAck(payload: PlayerOwnerAckPayload): void {
    this.onServerTime?.(payload.serverTimeMs)
    if (payload.playerId !== this.localPlayerId) return

    if (
      this.acceptLocalAckCursor(
        payload.playerId,
        payload.lastProcessedInputSeq,
        "net.sync.owner_ack.regressed",
        "Local owner input ack regressed",
      )
    ) {
      this.onLocalAck?.({
        id: payload.id,
        x: payload.x,
        y: payload.y,
        vx: payload.vx,
        vy: payload.vy,
        lastProcessedInputSeq: payload.lastProcessedInputSeq,
        replayContext: payload.replayContext,
      })
    }
  }

  /**
   * Applies monotonic ACK cursor rules and consumes pending first-ACK `0`.
   *
   * Full sync exposes pre-first-input state as `0`; the first real owner ACK or
   * legacy batch ACK for `0` must still notify local reconciliation once.
   *
   * @param playerId - Local player id whose cursor is being applied.
   * @param lastProcessedInputSeq - ACK cursor from the server.
   * @param regressionEvent - Structured log event name for regressed cursors.
   * @param regressionMessage - Human-readable log message for regressions.
   * @returns True when the caller should emit the local ACK sample.
   */
  private acceptLocalAckCursor(
    playerId: string,
    lastProcessedInputSeq: number,
    regressionEvent: "net.sync.ack.regressed" | "net.sync.owner_ack.regressed",
    regressionMessage: string,
  ): boolean {
    const prev = this.lastAckByPlayer.get(playerId) ?? -1
    const acceptsPendingZero =
      lastProcessedInputSeq === 0 &&
      prev === 0 &&
      this.pendingFirstZeroAckByPlayer.has(playerId)
    if (lastProcessedInputSeq < prev) {
      this.log.warn(
        {
          event: regressionEvent,
          playerId,
          previousSeq: prev,
          seq: lastProcessedInputSeq,
        },
        regressionMessage,
      )
      return false
    }
    if (lastProcessedInputSeq === prev && !acceptsPendingZero) return false

    this.lastAckByPlayer.set(playerId, lastProcessedInputSeq)
    this.pendingFirstZeroAckByPlayer.delete(playerId)
    return true
  }
}
