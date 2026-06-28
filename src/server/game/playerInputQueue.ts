import { decodePlayerInputStateRun } from "@/shared/playerInputState"
import type { PlayerInputPayload } from "@/shared/types"
import type { PlayerInputCommandRunPayload } from "@/shared/types"

export type PlayerInputQueueMap = Map<string, PlayerInputQueue>

/**
 * Server-side per-player input queue backed by a head-index deque.
 *
 * Consumed slots are nulled and periodically compacted so long matches do not
 * retain stale input payloads while hot-path consumption avoids `Array.shift()`.
 */
export class PlayerInputQueue {
  private items: Array<PlayerInputPayload | undefined>
  private head = 0

  /**
   * Creates a queue with optional initial payloads in logical order.
   *
   * @param inputs - Initial logical queue contents.
   */
  constructor(inputs: readonly PlayerInputPayload[] = []) {
    this.items = [...inputs]
  }

  /** Logical number of queued payloads remaining. */
  get length(): number {
    return this.items.length - this.head
  }

  /** Current backing-array length for tests and perf diagnostics. */
  get backingLengthForDiagnostics(): number {
    return this.items.length
  }

  /**
   * Appends one payload to the logical tail.
   *
   * @param input - Payload to enqueue.
   */
  push(input: PlayerInputPayload): void {
    this.items.push(input)
  }

  /**
   * Appends every command sequence covered by a compact protocol v2 run.
   *
   * @param run - Validated compact command run to materialize into the queue.
   */
  pushRun(run: PlayerInputCommandRunPayload): void {
    for (let seq = run.fromSeq; seq <= run.toSeq; seq += 1) {
      this.push(decodePlayerInputStateRun(run, seq))
    }
  }

  /**
   * Returns a queued payload without consuming it.
   *
   * @param offset - Logical offset from the head.
   * @returns The queued payload, if present.
   */
  peek(offset = 0): PlayerInputPayload | undefined {
    if (offset < 0 || offset >= this.length) return undefined
    return this.items[this.head + offset]
  }

  /**
   * Returns the newest logical payload without consuming it.
   *
   * @returns The newest queued payload, if present.
   */
  latest(): PlayerInputPayload | undefined {
    if (this.length <= 0) return undefined
    return this.items[this.items.length - 1]
  }

  /**
   * Finds the newest logical payload matching a held-intent predicate.
   *
   * @param predicate - Match predicate.
   * @returns The newest matching queued payload, if present.
   */
  latestMatchingHeldIntent(
    predicate: (input: PlayerInputPayload) => boolean,
  ): PlayerInputPayload | undefined {
    for (let index = this.items.length - 1; index >= this.head; index -= 1) {
      const input = this.items[index]
      if (input !== undefined && predicate(input)) return input
    }
    return undefined
  }

  /**
   * Consumes and returns the oldest logical payload.
   *
   * @returns The consumed payload, if present.
   */
  consume(): PlayerInputPayload | undefined {
    if (this.length <= 0) return undefined
    const input = this.items[this.head]
    this.items[this.head] = undefined
    this.head += 1
    this.compactIfNeeded()
    return input
  }

  /**
   * Consumes oldest payloads while a predicate matches.
   *
   * @param predicate - Predicate applied to the current head payload.
   * @param onConsume - Optional observer for each consumed payload.
   * @returns Count of consumed payloads.
   */
  consumeWhile(
    predicate: (input: PlayerInputPayload) => boolean,
    onConsume?: (input: PlayerInputPayload) => void,
  ): number {
    let consumed = 0
    let next = this.peek()
    while (next !== undefined && predicate(next)) {
      const input = this.consume()
      if (input === undefined) break
      onConsume?.(input)
      consumed += 1
      next = this.peek()
    }
    return consumed
  }

  /**
   * Drops queued payloads with `seq <= maxSeq`.
   *
   * @param maxSeq - Inclusive sequence cursor.
   * @returns Count of dropped payloads.
   */
  dropThroughSeq(maxSeq: number): number {
    return this.consumeWhile((input) => input.seq <= maxSeq)
  }

  /**
   * Drops oldest logical entries until the queue length is at most `cap`.
   *
   * @param cap - Maximum logical queue length.
   * @returns Count of dropped payloads.
   */
  trimToCap(cap: number): number {
    const boundedCap = Math.max(0, Math.trunc(cap))
    let dropped = 0
    while (this.length > boundedCap) {
      if (this.consume() === undefined) break
      dropped += 1
    }
    return dropped
  }

  /** Clears all logical and backing storage. */
  clear(): void {
    this.items = []
    this.head = 0
  }

  /** Compacts cleared head slots once the backing storage is meaningfully sparse. */
  compactIfNeeded(): void {
    if (this.head === 0) return
    if (this.head >= this.items.length) {
      this.clear()
      return
    }
    if (this.head >= 64 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head)
      this.head = 0
    }
  }

  /**
   * Returns logical queue contents for tests and diagnostics.
   *
   * @returns Queued payloads from oldest to newest.
   */
  toArray(): PlayerInputPayload[] {
    const out: PlayerInputPayload[] = []
    for (let index = this.head; index < this.items.length; index += 1) {
      const input = this.items[index]
      if (input !== undefined) out.push(input)
    }
    return out
  }
}
