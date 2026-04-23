# MVP plan closure (Goal B snapshot)

This file tracks the **“fix blank arena + MVP spec”** work against the long-form MVP spec at `~/.cursor/plans/wizard-wars-mvp-plan_a7ef604e.plan.md` (not committed in this repo) and the implementation plan for arena/sync.

## Status (major bullets)

| Area | Status | Note |
|------|--------|------|
| **Decision 68 — three pack JSONs under `public/assets/`** | **Done** | `assets/*-asset-pack.json` URLs in Boot / Preload / Arena. |
| **F5 / F15 — tilemap + pack in real route** | **Done** | Pack 200; tilemap + terrain image load from pack. |
| **F18 — `lady-wizard` Phaser load** | **Done** | Megasheet in `public/…/lady-wizard-megasheet.png`, registered in `arena-asset-pack.json` (spritesheet), aligned with `LadyWizardAnimDefs`. |
| **Network — `GameStateSync` at match start** | **Done** | `buildGameStateSyncPayload` + broadcast after `MatchGo` + `seq: 0`. |
| **RequestResync — `game_state_sync` (players only)** | **Done** | Unicast in `IN_PROGRESS` with Zod parse. |
| **Projectiles in resync** | **Deferred** | Track as GitHub issue: extend payload or companion message for fireballs/FX on reconnect. |
| **Zod on every `GameStateSync` send** | **Done** | `parseGameStateSyncPayload` on broadcast + resync unicast. |
| **Client `applyFullSync` despawn (r5)** | **Done** | `NetworkSyncSystem` + `PlayerRenderSystem` + unit test (T5) for ECS path. |
| **JWT `sub` → `localPlayerId` (nametag)** | **Done** | `mountGame` / registry / `PlayerRenderSystem`. |
| **Kill feed UI** | **Deferred** | Not in P0 path; file issue with MVP ref if prioritized. |
| **Spectator banner / UX** | **N/A (partial)** | `SpectatorTag` and sim paths exist; dedicated spectator HUD banner not in this PR. |
| **`compile-arena-colliders` script** | **Deferred** | No script in repo; `arena` balance data references Tiled. File issue to add script or document manual workflow. |
| **E2E — GET pack 200 (no flake-y canvas)** | **Done** | `tests/e2e/arena-assets.spec.ts`. |
| **Grill `grill-open-questions` (MVP YAML)** | **N/A in-repo** | Addressed in plan session; this table replaces duplicating that YAML. |

## Regenerate hero art

- Per-direction sheets: `bun run build:lady-wizard-sheets` (if present) / `bunx tsx scripts/build-lady-wizard-sheets.ts`
- Megasheet: `bun run build:lady-wizard-megasheet`

## TDD

Phaser/tilemap wiring remains a documented exception for pixel-level tests; server + Zod + ECS tests cover the sync path.
