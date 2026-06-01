# Wizard Wars Context Map

This repo uses multiple domain contexts. Read the context most relevant to the work, plus any adjacent contexts when the change crosses boundaries.

| Context | Context Doc | Primary Code / Files |
| --- | --- | --- |
| `web-app-ui` | `docs/contexts/web-app-ui/CONTEXT.md` | `src/app/**`, `src/components/**`, `src/lib/ui/**` |
| `browser-game-client` | `docs/contexts/browser-game-client/CONTEXT.md` | `src/game/**`, browser-facing game UI under `src/app/(protected)/lobby/[id]/game/**` |
| `shared-game-contracts-and-rules` | `docs/contexts/shared-game-contracts-and-rules/CONTEXT.md` | `src/shared/**`, shared collision/config/keybind/settings/sprite contracts |
| `authoritative-game-simulation` | `docs/contexts/authoritative-game-simulation/CONTEXT.md` | `src/server/game/**`, server-side game systems and simulation tests |
| `realtime-rooms` | `docs/contexts/realtime-rooms/CONTEXT.md` | `src/server/colyseus/**`, room lifecycle and connection orchestration |
| `web-backend-platform` | `docs/contexts/web-backend-platform/CONTEXT.md` | `server.ts`, `src/app/api/**`, `src/server/auth/**`, `src/server/trpc/**`, `src/server/db/**`, `src/server/admin/**`, `src/server/store/**`, `prisma/**` |
| `delivery-ops` | `docs/contexts/delivery-ops/CONTEXT.md` | `.github/**`, `Dockerfile`, `docker-compose.yml`, `render.yaml`, `scripts/**`, deployment/env/test tooling |

## Boundary Notes

- `shared-game-contracts-and-rules` owns artifacts that must mean the same thing on both client and server: schemas, generated balance/config data, collision helpers, keybind/settings contracts, sprite metadata, and cross-boundary logging/config shapes.
- `authoritative-game-simulation` owns server truth: combat resolution, movement outcomes, match lifecycle, damage, hazards, economy, respawn/lives, and projectile outcomes.
- `realtime-rooms` owns network/session orchestration around Colyseus rooms, not the game rules themselves.
- `web-backend-platform` owns HTTP/auth/persistence/platform behavior outside the realtime room boundary.
- Context `CONTEXT.md` files are created lazily as terminology and decisions get settled.

System-wide architectural decisions live in `docs/adr/`. Context-specific ADRs may live under `docs/contexts/<context>/adr/`.

Supporting repo docs:

- `docs/glossary.md` owns cross-context domain vocabulary.
- `docs/contexts/realtime-rooms/protocols.md` owns the durable event protocol summary.
- `docs/retros/` owns concise incident/learning writeups that affect future engineering work.
- `docs/roadmaps/` owns future-facing plans that are not current architecture truth.

The Obsidian vault at `/Users/jakemcbride/Personal/Development/ObsidianVault/Projects/wizard-wars/` remains the source for raw research, session history, and personal synthesis.
