import type { GameStateSyncPayload, PlayerBatchUpdatePayload } from "@/shared/types"
import {
  ClientPosition,
  ClientPlayerState,
} from "../components"
import { addEntity, hasEntity, clientEntities, removeEntity } from "../world"

/**
 * Applies authoritative server state updates to the client ECS component records.
 * Position data written here is consumed by PlayerRenderSystem for interpolation.
 */
export class NetworkSyncSystem {
  /**
   * Replaces all client entity state with the full server snapshot.
   * Used on connect or reconnect.
   *
   * @param payload - Full game state from the server.
   */
  applyFullSync(payload: GameStateSyncPayload): void {
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
      ClientPlayerState[snap.id] = {
        playerId: snap.playerId,
        username: snap.username,
        heroId: snap.heroId,
        health: snap.health,
        maxHealth: snap.maxHealth,
        lives: snap.lives,
        animState: snap.animState,
        facingAngle: snap.facingAngle,
        invulnerable: snap.invulnerable,
      }
    }
  }

  /**
   * Merges a partial batch update into existing component records.
   * Only fields present in the delta are updated.
   *
   * @param payload - Batch delta update from the server.
   */
  applyBatchUpdate(payload: PlayerBatchUpdatePayload): void {
    for (const delta of payload.deltas) {
      const pos = ClientPosition[delta.id]
      const state = ClientPlayerState[delta.id]

      if (pos && delta.x !== undefined && delta.y !== undefined) {
        pos.x = delta.x
        pos.y = delta.y
      }

      if (state) {
        if (delta.facingAngle !== undefined) state.facingAngle = delta.facingAngle
        if (delta.health !== undefined) state.health = delta.health
        if (delta.lives !== undefined) state.lives = delta.lives
        if (delta.animState !== undefined) state.animState = delta.animState
        if (delta.invulnerable !== undefined) state.invulnerable = delta.invulnerable
      }
    }
  }
}
