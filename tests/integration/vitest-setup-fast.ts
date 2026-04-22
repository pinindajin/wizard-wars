/**
 * Vitest setup for the fast integration tier.
 * Sets AUTH_SECRET if absent (needed by verifyToken / signToken in Colyseus rooms).
 * Does NOT import @/server/db — this tier runs without a Postgres connection.
 */
if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = "vitest-fast-integration-auth-secret-32chars"
}
