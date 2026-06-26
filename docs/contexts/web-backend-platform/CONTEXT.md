# Web Backend Platform Context

## Purpose

Own HTTP server platform behavior: the custom Bun/Express/Next host, API routes, tRPC, auth, persistence, admin/dev backend helpers, logging, and database integration.

## Owned Concepts

- `server.ts` bootstrap: Next app, Express handler, web-only mode, single-process local fallback with Colyseus co-hosting, WebSocket upgrade routing, and process-global matchMaker exposure only in fallback mode.
- Auth: JWT signing/verification, `ww-token` cookie, protected route helpers, password hashing, rate limiting, session-expired redirect, and optional DB-backed protected user verification.
- tRPC routers and route handlers under `src/app/api/**`.
- Prisma database access and repository/store modules.
- Backend structured logging and admin log-level override.
- Backend helpers for dev tools, animation tool asset import/archive, lobby dashboard APIs, and health checks.

## Key Flows

- Server bootstrap resolves log level, validates `AUTH_SECRET`, applies DB log-level override, prepares Next, then either runs web-only mode (`WW_SERVER_MODE=web`) or the legacy single-process fallback (`WW_SERVER_MODE` unset/`single`). Web-only mode can proxy Colyseus matchmake HTTP and websocket upgrades to `WW_REALTIME_PROXY_URL` for single-container split deployments.
- Auth/signup/login create a `ww-token` JWT cookie; protected routes verify it and optionally check the DB row when `VERIFY_USER_ON_PROTECTED=true`.
- `/api/auth/ws-token` gives browser code a token path for Colyseus joins without exposing the HttpOnly cookie directly.
- Web-only admin/lobby routes call the realtime process through `WW_REALTIME_ADMIN_URL` with `WW_REALTIME_ADMIN_TOKEN`; missing/unreachable realtime maps to explicit 503/504 responses.
- tRPC procedures provide auth/user/chat operations; API routes provide lobbies, health, and dev tooling endpoints.
- Prisma migrations run only when the runtime owner sets `RUN_MIGRATIONS=true`.

## Boundaries

- Does not own realtime room phase semantics or match simulation loops.
- Does not own browser UI state; route handlers return contracts consumed by `web-app-ui`.
- Avoid importing browser/Phaser-only modules into server routes.
- Keep Edge middleware compatible: JWT/cookie helpers used by middleware must stay free of Prisma, bcrypt, logger, dotenv, and other Node-only imports.

## Code Anchors

- `server.ts`
- `middleware.ts`
- `src/app/api/**`
- `src/server/auth/**`
- `src/server/trpc/**`
- `src/server/db/**`
- `src/server/admin/**`
- `src/server/realtime/**`
- `src/server/dev/**`
- `src/server/store/**`
- `src/server/logger.ts`
- `prisma/**`

## Related Docs

- `docs/adr/0010-structured-logging-observability-roadmap.md`
- `docs/adr/0011-anim-tool-sheet-replace.md`
- `docs/adr/0013-protected-user-verification-boundaries.md`
- `docs/contexts/delivery-ops/CONTEXT.md`
