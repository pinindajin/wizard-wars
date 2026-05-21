# ADR 0013: Optional DB-Backed Protected User Verification

Status: Accepted
Date: 2026-05-01

## Context

Wizard Wars authenticates browser sessions with the `ww-token` HttpOnly JWT. Edge-compatible middleware verifies the JWT and redirects missing/invalid sessions to `/login?next=<original path>`. tRPC protected procedures also trust the verified JWT subject.

Development DB resets exposed stale-session failures: a JWT could verify while the corresponding `User` row was gone, causing Prisma `P2025` on settings save.

The desired behavior:

- Default protected-route behavior remains JWT-only.
- An opt-in env flag adds DB-row verification for protected Node surfaces.
- The settings save path still normalizes missing-user update failures when the flag is off.

## Decision

Add `VERIFY_USER_ON_PROTECTED`, documented as a boolean env var. Missing, empty, and `"false"` are false. `"true"` is the documented truthy value; `"1"` is accepted as a convenience.

When `VERIFY_USER_ON_PROTECTED=false`:

- Keep JWT-only protected route behavior.
- Do not add DB checks to every protected page/API.
- Still catch `P2025` from settings save, clear `ww-token`, and return `UNAUTHORIZED`.

When `VERIFY_USER_ON_PROTECTED=true`:

- Verify that the JWT user still exists in the DB on Node server surfaces:
  - tRPC `protectedProcedure`
  - `/api/auth/ws-token`
  - `/api/lobbies`
  - protected App Router pages/layouts through `(protected)` layout
- Keep root middleware Edge-compatible and JWT-only.
- Let middleware overwrite an internal pathname header so the protected layout can redirect accurately.
- Clear `ww-token` and redirect/return `401` when the user row is missing.

Protected App Router layouts must not mutate cookies directly. They redirect to a Node route handler such as `/api/auth/session-expired?next=<relative-path>`, which clears the cookie and redirects to `/login?next=<safe-next>&reason=session-expired`.

Do not add Prisma checks to Colyseus `onAuth` yet. Normal browser joins already go through `/api/auth/ws-token`.

## Consequences

- Stale dev cookies become recoverable auth failures instead of raw Prisma errors.
- Production keeps lightweight JWT-only behavior unless explicitly configured.
- With the flag enabled, protected page requests add a DB lookup before rendering.
- Middleware stays Edge-compatible.
- Colyseus may still accept a direct stale JWT if a client bypasses `/api/auth/ws-token`; this is an intentional deferred hardening point.

## Related Code

- `src/server/auth/**`
- `middleware.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/api/auth/ws-token/route.ts`
- `src/app/api/auth/session-expired/route.ts`
- `src/server/trpc/init.ts`
