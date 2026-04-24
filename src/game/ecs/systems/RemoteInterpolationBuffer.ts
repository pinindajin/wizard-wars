import {
  REMOTE_EXTRAPOLATION_CAP_MS,
  TELEPORT_THRESHOLD_PX,
} from "@/shared/balance-config/rendering"

/**
 * One authoritative snapshot of a remote entity at a specific server time.
 * Kept intentionally small — just what the interpolation math needs.
 */
export type RemoteSample = {
  readonly serverTimeMs: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly facingAngle: number
  readonly moveFacingAngle: number
}

/** Result of a `sampleAt` call. */
export type SampleResult = {
  readonly x: number
  readonly y: number
  readonly facingAngle: number
  readonly moveFacingAngle: number
}

/**
 * Per-remote rolling ring buffer of authoritative snapshots. Samples are
 * pushed in server-time order (old → new). The render path asks for a
 * position at `renderTime = now - REMOTE_RENDER_DELAY_MS`, and this module:
 *
 *  - Two-point interpolates between the surrounding samples when possible.
 *  - If `renderTime` is older than the oldest sample, returns the oldest.
 *  - If `renderTime` is newer than the newest, extrapolates forward using
 *    velocity, capped at `REMOTE_EXTRAPOLATION_CAP_MS` to avoid runaway.
 *  - Snaps to the newest sample if two consecutive samples are farther apart
 *    than `TELEPORT_THRESHOLD_PX` (e.g. respawns).
 *
 * Bounded by `capacity`; oldest samples are dropped first so memory stays
 * flat even during long matches.
 */
export class RemoteInterpolationBuffer {
  private readonly samples: Map<number, RemoteSample[]> = new Map()

  /**
   * @param capacity - Max samples retained per remote. `16` covers ~260 ms
   *   of history at 60 Hz — plenty for a 33 ms render delay with jitter.
   */
  constructor(private readonly capacity: number = 16) {}

  /**
   * Records a new authoritative sample for a remote entity.
   *
   * @param id - Entity id.
   * @param sample - Authoritative snapshot, stamped with server time.
   */
  push(id: number, sample: RemoteSample): void {
    let bucket = this.samples.get(id)
    if (!bucket) {
      bucket = []
      this.samples.set(id, bucket)
    }
    bucket.push(sample)
    while (bucket.length > this.capacity) {
      bucket.shift()
    }
  }

  /** Drops all samples for a remote (despawn). */
  remove(id: number): void {
    this.samples.delete(id)
  }

  /** Drops all samples for all remotes (match end / reconnect). */
  clear(): void {
    this.samples.clear()
  }

  /** Returns whether this buffer has any samples for `id`. */
  has(id: number): boolean {
    const bucket = this.samples.get(id)
    return bucket !== undefined && bucket.length > 0
  }

  /**
   * Samples the remote's position at a given render time. Returns `null`
   * when no samples are available.
   *
   * @param id - Entity id.
   * @param renderTimeMs - Target server time in ms to sample.
   */
  sampleAt(id: number, renderTimeMs: number): SampleResult | null {
    const bucket = this.samples.get(id)
    if (!bucket || bucket.length === 0) return null

    // Before the oldest: clamp to oldest.
    if (renderTimeMs <= bucket[0]!.serverTimeMs) {
      const s = bucket[0]!
      return {
        x: s.x,
        y: s.y,
        facingAngle: s.facingAngle,
        moveFacingAngle: s.moveFacingAngle,
      }
    }

    // After the newest: extrapolate using velocity, capped.
    const last = bucket[bucket.length - 1]!
    if (renderTimeMs >= last.serverTimeMs) {
      const dtMs = Math.min(REMOTE_EXTRAPOLATION_CAP_MS, renderTimeMs - last.serverTimeMs)
      const dtSec = dtMs / 1000
      return {
        x: last.x + last.vx * dtSec,
        y: last.y + last.vy * dtSec,
        facingAngle: last.facingAngle,
        moveFacingAngle: last.moveFacingAngle,
      }
    }

    // Find the two samples bracketing renderTimeMs.
    for (let i = 1; i < bucket.length; i++) {
      const prev = bucket[i - 1]!
      const next = bucket[i]!
      if (renderTimeMs >= prev.serverTimeMs && renderTimeMs <= next.serverTimeMs) {
        const dx = next.x - prev.x
        const dy = next.y - prev.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > TELEPORT_THRESHOLD_PX) {
          return {
            x: next.x,
            y: next.y,
            facingAngle: next.facingAngle,
            moveFacingAngle: next.moveFacingAngle,
          }
        }
        const span = next.serverTimeMs - prev.serverTimeMs || 1
        const alpha = (renderTimeMs - prev.serverTimeMs) / span
        return {
          x: prev.x + dx * alpha,
          y: prev.y + dy * alpha,
          facingAngle: next.facingAngle,
          moveFacingAngle: next.moveFacingAngle,
        }
      }
    }

    // Should not reach here; return newest as a safe fallback.
    return {
      x: last.x,
      y: last.y,
      facingAngle: last.facingAngle,
      moveFacingAngle: last.moveFacingAngle,
    }
  }
}
