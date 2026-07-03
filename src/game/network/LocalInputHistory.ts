import type { PlayerInputPayload } from "@/shared/types"

/**
 * Bounded, in-order history of inputs the local player has sent but the
 * server has not yet acknowledged. The client uses this on every authoritative
 * batch to drive rewind-and-replay reconciliation:
 *
 * 1. On send, `append(input)` records the payload (cheap — inputs are plain
 *    data).
 * 2. On ack (server reports `lastProcessedInputSeq = K`), `discardThrough(K)`
 *    drops inputs with `seq <= K`.
 * 3. The remaining inputs (`pending()`) are replayed on top of the ACKed
 *    authoritative state to reproduce the predicted local position.
 *
 * The buffer is bounded by `capacity`; when full, the oldest entry is
 * dropped first so we never grow without bound if the server stalls.
 */
export class LocalInputHistory {
  private readonly items: PlayerInputPayload[] = []

  /**
   * @param capacity - Maximum number of pending inputs retained. At 60 Hz,
   *   `120` covers ~2 seconds of input — far more than realistic RTTs.
   */
  constructor(private readonly capacity: number = 120) {}

  /**
   * Appends an input to the tail of the history.
   *
   * @param input - The full `PlayerInputPayload` the client just sent.
   */
  append(input: PlayerInputPayload): void {
    this.items.push(input)
    if (this.items.length > this.capacity) {
      this.items.shift()
    }
  }

  /**
   * Drops inputs with `seq <= ackedSeq`. Silent no-op if the tail is already
   * above the ack (e.g. out-of-order acks).
   *
   * @param ackedSeq - Highest server-acknowledged `seq` for this player.
   */
  discardThrough(ackedSeq: number): void {
    while (this.items.length > 0 && this.items[0]!.seq <= ackedSeq) {
      this.items.shift()
    }
  }

  /** Returns a read-only view of still-pending inputs, in send order. */
  pending(): readonly PlayerInputPayload[] {
    return this.items
  }

  /** Current number of pending inputs (for instrumentation / tests). */
  size(): number {
    return this.items.length
  }

  /** Clears the buffer (match end, reconnect, etc.). */
  clear(): void {
    this.items.length = 0
  }
}
