# Integration Tests

Tests under `tests/integration/` are split into two tiers by **file-name suffix**.

## Tiers

| Suffix | Script | Needs Postgres? | Config |
|---|---|---|---|
| `*.fast.test.ts` | `bun run test:integration:fast` | No | `vitest.integration.fast.config.ts` |
| `*.slow.test.ts` | `bun run test:integration:slow` | Yes | `vitest.integration.slow.config.ts` |

Run both with: `bun run test:integration`

## Fast tier

- Boots in-process Colyseus rooms (no real server on port 3000).
- Tests that touch `@/server/db` must **mock it**:

```ts
vi.mock("@/server/db", () => ({
  prisma: {
    user: { findFirst: vi.fn(() => null), create: vi.fn() },
    // … add only the methods this test exercises
  },
}))
```

- `AUTH_SECRET` is set in `vitest-setup-fast.ts` — no `.env` needed.
- Use `tests/integration/helpers/colyseus-test-server.ts` to boot an in-process server:

```ts
import { bootTestServer, createTestToken, shutdownTestServer } from "./helpers/colyseus-test-server"

const server = await bootTestServer()
const token = await createTestToken("test-uid", "testUser")
const room = await server.sdk.joinOrCreate("chat", { token })
// … assertions …
await shutdownTestServer(server)
```

## Slow tier

- Requires a running Postgres. Start one with: `bun run docker:up:db`
- Run migrations before the suite: `bunx prisma migrate deploy`
- The `vitest-setup-slow.ts` runs `SELECT 1` in `beforeAll` to verify connectivity.
- Import `prisma` directly — no mocking needed or desired.

## Deciding which tier

Pick **fast** when the code under test does not need to read from or write to the database.
Pick **slow** when the test exercises a real Prisma query, transaction, migration correctness, or DB constraint.

When in doubt: fast first, promote to slow only if you need a real DB assertion.
