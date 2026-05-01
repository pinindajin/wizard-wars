# Wizard Wars

Multiplayer top-down arena shooter. Built with Next.js 16, Bun, Phaser 4, Colyseus 0.17, bitECS 0.4, and Postgres.

## Documentation

All long-form architecture, ADRs, and learnings live in the Obsidian vault:
`/Users/jakemcbride/Personal/Development/ObsidianVault/Projects/wizard-wars/`

## Quick Start

```bash
# 1. Copy environment file
cp sample.env .env

# 2. Start Postgres (hybrid dev: Bun + Docker DB)
bun run dev:hybrid

# 3. Run migrations
bunx prisma migrate dev

# 4. Open browser
open http://localhost:3000
```

## Dev tools (local)

| URL | Purpose |
|-----|---------|
| [http://localhost:3000/dev/sprite-viewer](http://localhost:3000/dev/sprite-viewer) | Inspect shipped lady-wizard strip PNGs from `public/assets/sprites/heroes/lady-wizard/sheets/atlas.json` with collision and alpha-edge overlays (no auth, no game session). |
| [http://localhost:3000/dev/animation-tool](http://localhost:3000/dev/animation-tool) | Tune hero animation timing across all 8 directions at once. Run with `bun run dev:animation-tool`; save local snapshots to `tools/animation/output/`, then commit runtime timing by running `bun run dev:animation-sync`. Disabled in production. |
| `http://localhost:3000/dev/phaser` | Phaser Editor bootstrap (minimal Phaser mount). |

Optional Playwright visual capture for the sprite viewer: `WW_SPRITE_VIEWER_VISUAL=1 bunx playwright test tests/e2e/sprite-viewer.spec.ts` (writes `test-results/sprite-viewer-detail.png`).

Animation timing is authored in milliseconds and executed on the fixed 60 Hz simulation tick. The server runs effects on the first tick at or after the configured ms; frame numbers shown in the tool are developer aids only.

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev:hybrid` | Start app with docker Postgres |
| `bun run dev:animation-tool` | Start the app for `/dev/animation-tool` |
| `bun run dev:animation-sync` | Validate `tools/animation/output/latest.json` and write `src/shared/balance-config/animation-config.json` |
| `bun run check:animation-config` | Validate committed animation config (also runs in Husky pre-commit; use `HUSKY=0 git commit ...` only for emergency bypass) |
| `bun run test` | Unit tests |
| `bun run test:coverage` | Unit tests with coverage (enforces **95%** lines/branches/functions/statements in `vitest.config.ts` on the measured `src/` set) |
| `bun run test:integration` | Integration tests |
| `bun run test:all` | All tests |
| `bun run db:studio` | Open Prisma Studio |

## GitHub

Repository: `github.com/pinindajin/wizard-wars` (private)

## Tech Stack

- **Frontend**: Next.js 16 App Router, Phaser 4, React 19, Tailwind CSS 4
- **Backend**: Bun, Express 5, Colyseus 0.17, tRPC v11, Prisma 6
- **Game Logic**: bitECS 0.4, server-authoritative 60 Hz simulation with per-player input queue (seq + clientSendTimeMs), enriched snapshots (velocity + move state + `lastProcessedInputSeq` + `serverTimeMs`), client rewind-and-replay reconciliation with shared world-collision math, and a per-remote interpolation buffer with bounded velocity extrapolation
- **Database**: PostgreSQL 16
- **CI**: GitHub Actions (unit + integration)
- **Hosting**: Render
