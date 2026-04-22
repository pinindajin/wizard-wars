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

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev:hybrid` | Start app with docker Postgres |
| `bun run test` | Unit tests |
| `bun run test:coverage` | Unit tests with coverage (enforces `vitest.config.ts` thresholds) |
| `bun run test:integration` | Integration tests |
| `bun run test:all` | All tests |
| `bun run db:studio` | Open Prisma Studio |

## GitHub

Repository: `github.com/pinindajin/wizard-wars` (private)

## Tech Stack

- **Frontend**: Next.js 16 App Router, Phaser 4, React 19, Tailwind CSS 4
- **Backend**: Bun, Express 5, Colyseus 0.17, tRPC v11, Prisma 6
- **Game Logic**: bitECS 0.4, server-authoritative 20 Hz simulation
- **Database**: PostgreSQL 16
- **CI**: GitHub Actions (unit + integration)
- **Hosting**: Render
