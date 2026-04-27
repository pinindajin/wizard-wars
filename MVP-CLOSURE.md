# MVP plan closure (Goal B snapshot)

This file tracks the **“fix blank arena + MVP spec”** work against the long-form MVP spec at `~/.cursor/plans/wizard-wars-mvp-plan_a7ef604e.plan.md` (not committed in this repo) and the implementation plan for arena/sync.

## Status (major bullets)

| Area | Status | Note |
|------|--------|------|
| **Decision 68 — three pack JSONs under `public/assets/`** | **Done** | `assets/*-asset-pack.json` URLs in Boot / Preload / Arena. |
| **F5 / F15 — tilemap + pack in real route** | **Done** | Pack 200; tilemap + terrain image load from pack. |
| **F18 — `lady-wizard` Phaser load** | **Done** | Megasheet in `public/…/lady-wizard-megasheet.png`, registered in `arena-asset-pack.json` (spritesheet), aligned with `LadyWizardAnimDefs`. |
| **Network — `GameStateSync` at match start** | **Done** | `buildGameStateSyncPayload` + broadcast after `MatchGo` + `seq: 0`; payload includes `fireballs`. |
| **RequestResync — `game_state_sync`** | **Done** | Unicast in `IN_PROGRESS` with Zod parse; includes players + `fireballs`. |
| **Projectiles in resync** | **Done** | `GameStateSyncPayload.fireballs` + client `ProjectileRenderSystem.applyFullSyncFireballs`; idempotent `spawnFireball`. |
| **Zod on every `GameStateSync` send** | **Done** | `parseGameStateSyncPayload` on broadcast + resync unicast. |
| **Client `applyFullSync` despawn (r5)** | **Done** | ECS: `NetworkSyncSystem` (T5). Phaser teardown: `PlayerRenderSystem.test.ts` (mock scene). |
| **JWT `sub` → `localPlayerId` (nametag)** | **Done** | `mountGame` / registry / `PlayerRenderSystem`. |
| **Kill feed UI** | **Done** | `KillFeed` + `formatKillFeedLine`; `PlayerDeath` + usernames + `parsePlayerDeathPayload`. |
| **Spectator banner / UX** | **Done** | Banner + hide ability/quick bars when spectating; `GameStateSync` / batch / death wiring in `LobbyGameHost`. |
| **`compile-arena-colliders` script** | **Done** | `scripts/compile-arena-colliders.ts`, `bun run build:arena-colliders`, layer `PropColliders` in `arena.json`, generated `arena-prop-colliders.ts`. |
| **PixelLab arena import** | **Done** | `bun run import:pixellab-arena -- <export-dir>` imports PixelLab map exports into the Phaser Editor arena, keeps original 16 terrain GIDs, appends scaled 64px PixelLab tiles, and generates safe spawn layout. |
| **E2E — assets + canvas** | **Done** | `arena-assets.spec.ts` (GET pack); `match-start-game-route.spec.ts` asserts Phaser canvas non-zero bbox. |
| **Grill `grill-open-questions` (MVP YAML)** | **N/A in-repo** | Addressed in plan session; this table replaces duplicating that YAML. |

## Regenerate hero art

- Per-direction sheets: `bun run build:lady-wizard-sheets` (if present) / `bunx tsx scripts/build-lady-wizard-sheets.ts`
- Megasheet: `bun run build:lady-wizard-megasheet`
- PixelLab arena: `bun run import:pixellab-arena -- /Users/jakemcbride/Downloads/wizard-wars-pixel-lab-export-01`
- Prop colliders (Tiled layer **PropColliders**): `bun run build:arena-colliders`

## PixelLab export notes

- `map.json`: PixelLab map manifest; includes tile size, map dimensions, bounding box, terrain names, and tileset references.
- `terrain-map.json`: per-cell terrain labels used to classify lava, safe ground, and transition terrain.
- `transition-map.json`: per-cell edge transitions; importer treats these cells as unsafe spawn cells.
- `map-composite.png`: rendered 32px map image; importer deduplicates its tiles, scales them to 64px with nearest-neighbor, and appends them after the existing 16 source tiles.
- `tilesets/*.png`: source PixelLab tileset art/reference; current export does not include separate metadata JSON, so importer uses the composite image plus terrain/transition maps.
- Phaser Editor compatibility still follows Obsidian ADR 0002: `/Users/jakemcbride/Personal/Development/ObsidianVault/Projects/wizard-wars/decisions/0002-phaser-editor-arena.md`.

## TDD

Phaser/tilemap wiring remains a documented exception for pixel-level tests; server + Zod + ECS tests cover the sync path. Playwright asserts canvas layout size on the game route (no screenshot baselines).
