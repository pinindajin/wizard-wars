# Architecture Improvement Roadmap

Status: Future-facing plan
Source: Obsidian `plans/2026-05-06-architecture-improvement-roadmap.md`

This roadmap is intent, not current behavior. Check live code before assuming any item has landed.

## Future Scale Targets

Wizard Wars is expected to grow toward:

- 10 players per match.
- Multiple arenas with shared base features and arena-specific variations.
- 50+ abilities, items, and augments.
- 10+ heroes with distinct animations and sounds.
- Animation-tool-driven gameplay timing windows.

## Tier 1: Before Content Volume Grows

1. Ability/effect registry
   - Replace named cooldown slots and switch dispatch with registered `AbilityDef` entries.
   - Adding an ability should require a config object, effect function, and animation entry rather than edits across many switches.

2. Generalized status effects
   - Replace per-effect tags with a composable `StatusEffect` representation for slow, shield, DoT, stun, invulnerability, and future effects.
   - Permanent state can remain in flags/tags where appropriate.

3. Arena registry
   - Introduce `ArenaDef` for tilemap, colliders, spawn points, asset pack, and optional arena features.
   - Avoid cloning the Phaser scene or collider pipeline per arena.

4. Colyseus schema for hot-path state
   - Move player hot-path state toward `@colyseus/schema` binary deltas behind a runtime switch.
   - Keep VFX/death/scoreboard events on the event channel.
   - Preserve prediction and reconciliation behavior during migration.

## Tier 2: Before Per-Hero Content Authoring

1. `animation-config.json` schema version 2
   - Add per-frame events such as SFX, hit windows, projectile spawn marks, and VFX marks.
   - Add per-hero ability sets.
   - Provide a migration from v1 with empty `events` arrays.

2. Hero registry
   - Introduce `HeroDef` with id, display name, sprite key, asset bundle, base stats, and ability ids.
   - Derive validators from registered heroes.
   - Remove hardcoded hero indices where possible.

3. Lazy asset bundles
   - Split a monolithic asset pack into core, arena, and hero bundles.
   - Load only the selected arena and selected hero assets for the match.

## Tier 3: Deferred Until Pressure Warrants

- Bun workspaces/monorepo split.
- Replacing the client ECS with bitECS.
- Hot-reloading `animation-config.json` into a running simulation.
- Replays or input-stream recording.

## Risks To Preserve

- Colyseus schema migration is high risk because prediction and reconciliation currently rely on the custom delta channel.
- Cooldown/status component layout changes touch many casting tests.
- Animation-config v2 is a breaking schema change and must land with tool/server/client consumers.
- Arena registry must respect Phaser Editor scene generation workflow.
- New shared registries must not import server or client modules.

## Execution Policy

Each tier item should ship as its own PR against `main` from an isolated worktree. Run lint, typecheck, unit tests, integration tests, and E2E before opening the PR unless the PR explicitly documents a justified exception.
