import { logger } from "../logger"

type TokenBucket = {
  count: number
  windowStartMs: number
}

/**
 * In-memory IP-based rate limiter using a sliding token bucket.
 * Post-MVP: replace with Redis or Render KV for multi-instance support.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>()

  constructor(
    private readonly maxCount: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Checks if the given key is within the rate limit and records the attempt.
   *
   * @param key - The rate limit key (e.g., IP address).
   * @returns `true` if the request is allowed; `false` if throttled.
   */
  check(key: string): boolean {
    const now = Date.now()
    const bucket = this.buckets.get(key)

    if (!bucket || now - bucket.windowStartMs > this.windowMs) {
      this.buckets.set(key, { count: 1, windowStartMs: now })
      return true
    }

    if (bucket.count >= this.maxCount) {
      logger.info({ event: "auth.rate_limit.hit", key }, "Rate limit exceeded")
      return false
    }

    bucket.count++
    return true
  }

  /**
   * Returns the remaining milliseconds in the current window for the key, or 0 if no bucket.
   *
   * @param key - The rate limit key.
   * @returns Milliseconds until the window resets.
   */
  retryAfterMs(key: string): number {
    const now = Date.now()
    const bucket = this.buckets.get(key)
    if (!bucket) return 0
    const elapsed = now - bucket.windowStartMs
    return Math.max(0, this.windowMs - elapsed)
  }

  /**
   * Resets the rate limit bucket for a key (e.g., after successful login).
   *
   * @param key - The rate limit key to reset.
   */
  reset(key: string): void {
    this.buckets.delete(key)
  }
}

/** Login rate limiter: 5 failed attempts per IP per 5 minutes. */
export const loginRateLimiter = new RateLimiter(5, 5 * 60 * 1000)

/** Signup rate limiter: 3 accounts per IP per hour. */
export const signupRateLimiter = new RateLimiter(3, 60 * 60 * 1000)
