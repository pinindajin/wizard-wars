# Web App UI Context

## Purpose

Own the Next.js and React surfaces players use outside the Phaser scene, plus the React shell that hosts game UI. This context translates authenticated app state into lobby, browser, settings, and HUD experiences.

## Owned Concepts

- Auth screens: login, signup, logout, and mutation error display.
- Protected app surfaces: `/home`, `/browse`, `/lobby/*`, `/dev/admin`, and `/dev/lobby-dashboard`.
- Lobby UI: lobby chrome, hero cards, idle/closing warnings, host/start controls, chat-adjacent UI.
- Game shell UI: React overlays, settings modal, shop modal, ability bars, quick item bar, kill feed, scoreboard, countdown/loading/waiting overlays.
- Client-side app helpers: tRPC client, endpoint helpers, client logging installer, UI style helpers.

## Key Flows

- Unauthenticated users are redirected to `/login?next=<original path>` by middleware and protected layouts.
- Auth forms call tRPC mutations, receive the `ww-token` HttpOnly cookie, and redirect into protected app flows.
- Lobby pages create or join Colyseus `game_lobby` rooms through the realtime context, then render roster/hero/host state from lobby payloads.
- The `/lobby/[id]/game` route mounts the Phaser game and wraps it with React-owned HUD/settings/shop overlays.
- Settings modal UI blocks gameplay input through React-side blocking and Phaser registry flags before keyboard/mouse controllers consume input.

## Boundaries

- Does not own authoritative gameplay outcomes, combat math, movement, or match lifecycle.
- Does not own Colyseus room protocol semantics; consume `RoomEvent` payloads from `shared-game-contracts-and-rules`.
- Game route React HUD/shell files live in this context only when they are pure UI. Logic that drives Phaser runtime, prediction, reconciliation, input cadence, audio playback, or render systems belongs to `browser-game-client`.
- Protected route verification policy is shared with `web-backend-platform`; UI should not import Prisma or server-only auth helpers.

## Code Anchors

- `src/app/(auth)/**`
- `src/app/(protected)/**`
- `src/app/dev/**`
- `src/components/**`
- `src/lib/**`
- `middleware.ts`

## Related Docs

- `docs/adr/0010-structured-logging-observability-roadmap.md`
- `docs/adr/0011-anim-tool-sheet-replace.md`
- `docs/adr/0013-protected-user-verification-boundaries.md`
- `docs/contexts/browser-game-client/CONTEXT.md`
- `docs/contexts/web-backend-platform/CONTEXT.md`
