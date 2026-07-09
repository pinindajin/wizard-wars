# No-Cliff Lava Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing arena with the new lava-surrounded arena art, editable Phaser Editor obstacle objects, no cliff regions, and lava entry from any walkable terrain edge.

**Architecture:** Keep the existing Phaser Editor data-scene contract: `Arena.scene` owns editable visual objects and rectangle regions, `Arena.ts` creates runtime visuals, `export-arena-tilemap.ts` exports editor regions to `arena.json`, and generated collider constants feed client/server collision. New generation uses committed source images under `public/assets/arena-review/no-cliff-lava/source-images/`: lava/no-obstacles is the base image, obstacle/no-obstacle diffs become editable prop instance sprites, and the no-background/no-obstacle alpha mask defines walkable terrain; inverse walkable cells are lava. Cliff output is intentionally empty.

**Tech Stack:** TypeScript, Phaser 4, Phaser Editor 2D scene JSON, Sharp, Vitest, Playwright, Bun.

---

## Summary

Current arena uses a 2804x2244 native image, many old prop sprites, lava/cliff generated regions, and land movement colliders that block non-walkable hazards. New supplied art is 4224x3392. The new map has lava at every terrain edge and internal holes; there is no cliff landing region. Players must be able to walk or be knocked from land into lava, then retain current lava damage/containment behavior.

Implementation uses a reproducible arena builder script instead of hand-editing huge scene JSON. The script reads committed source art, writes the runtime base map, extracts prop instance PNGs, writes `Arena.scene`/`Arena.ts`, writes layout metadata/spawns, then existing export scripts write `arena.json` and generated colliders.

Assumptions:
- Visual target is `map-lava-with-obstacles.png` (`image-4` by actual content); `image-5` is lava/no-obstacles base.
- Existing public protocol may still allow `"cliff"` for backward compatibility, but the new arena must generate zero cliff colliders and no sampled point in the map should return `"cliff"`.
- Lava containment remains: once terrain state is `"lava"` and grounded, normal movement stays inside lava unless jump rules allow escape.

## User Stories

- As a player, I want the arena to visually match the new lava map with obstacles so matches happen on the intended battlefield.
- As a player, I want walking or knockback beyond any stone edge to put me in lava so there are no invisible cliff/stumble strips.
- As a player, I want lava to keep damaging and constraining me as before once I am in it.
- As a designer, I want obstacles and collider rectangles editable in Phaser Editor so future map edits remain visual and maintainable.
- As an engineer, I want generated colliders and tests to prove no stale cliff geometry remains.

## Technical Requirements

- Runtime arena dimensions become `4224x3392`; broadphase cell size remains `64`, producing `66` columns and `53` rows.
- `public/assets/maps/arena-base.png` must be lava/no-obstacles art.
- `Arena.scene` must be Phaser Editor v5, data-only (`exportClass: false`), with `borderWidth: 4224`, `borderHeight: 3392`, base image, editable prop images, prop colliders, lava/non-walkable/walkable rectangles, and no `cliffArea_*` objects.
- `Arena.ts` must preserve the existing editorCreate/runtime wrapper pattern and create only the base image plus prop images at y-sort depths.
- `public/assets/tilemaps/arena.json` must export `SpawnPoints`, `PropColliders`, `NonWalkableAreas`, `LavaAreas`, empty `CliffAreas`, and `WalkableAreas`.
- Generated `ARENA_CLIFF_COLLIDERS` must be `[]`.
- Land movement/knockback collision must not include lava rectangles; props still block.
- Grounded lava movement must keep using the existing lava candidate gate and damage behavior.
- Spawns must be on walkable terrain, outside lava, and not overlapping prop colliders.
- Asset packs must reference `arena-base` and every prop instance texture used by `Arena.scene`.

## Decisions

- Use `map-lava-no-obstacles.png` as base plus editable prop sprites, not a fully baked target image, because ADR 0002 requires editor-visible scene objects.
- Extract per-instance prop sprites from source overlay diffs instead of manually matching each object to the sheet, because this preserves exact target placement/scale/shading and keeps every obstacle editable.
- Keep source images under `public/assets/arena-review/no-cliff-lava/source-images/` for reproducibility and provenance.
- Quantize walkable/lava masks to `16px` cells. This keeps collider counts manageable while tracking terrain edges closely enough for a 64px broadphase and player footprint.
- Keep `"cliff"` in shared protocol/types for compatibility; prove new arena never emits cliff terrain by generated data and tests.
- Change `ARENA_WORLD_COLLIDERS` semantics to "terrain blockers for land movement", i.e. props plus non-lava blockers. In this arena that means props only.

## Acceptance Criteria

- Given the game loads Arena, when the scene renders, then the base map is `4224x3392`, lava surrounds all terrain edges, and obstacle sprites draw over the base to match the supplied lava+obstacle image.
- Given Phaser Editor opens `src/game/scenes/Arena.scene`, when inspecting the display list, then base, prop images, prop colliders, lava/non-walkable/walkable rectangles are visible/editable and no cliff rectangles exist.
- Given a sampled lava point, when `terrainStateAtPosition` and indexed sampling run, then both return `"lava"`.
- Given a representative land spawn, when land movement steps toward an adjacent lava edge, then static world collision does not block lava entry.
- Given a player is grounded in lava, when movement attempts to leave lava without jump, then existing lava candidate gating keeps them in lava.
- Given generated colliders, when tests inspect `ARENA_CLIFF_COLLIDERS`, then it is empty.
- Given unit, integration, and e2e checks run, then arena parity, terrain behavior, and game boot still pass.

## Code Changes

- Create `scripts/build-no-cliff-lava-arena.ts`
  - Read source images from `public/assets/arena-review/no-cliff-lava/source-images/`.
  - Copy lava/no-obstacles source to `public/assets/maps/arena-base.png`.
  - Diff no-bg obstacle/no-obstacle images to generate prop instance PNGs in `public/assets/sprites/arena-props/`.
  - Generate prop image display objects and footprint colliders.
  - Generate 16px walkable and lava rectangle covers.
  - Generate safe spawn points by snapping preferred points to walkable, prop-free cells.
  - Write `Arena.scene`, `Arena.ts`, `arena-layout.ts`, `metadata.json`, `placements.json`, review overlay PNGs, and asset pack arena entries.
- Modify `src/shared/balance-config/arena.ts`
  - Keep generated non-walkable/lava regions for terrain sampling.
  - Set `ARENA_WORLD_COLLIDERS` to prop/non-hazard/cliff blockers, excluding lava.
  - Update comments for no-cliff lava terrain.
- Modify `src/shared/collision/terrainHazards.ts`
  - Ensure land collision uses the revised `ARENA_WORLD_COLLIDERS`.
  - Keep lava candidate gate and lava damage support.
- Modify `src/shared/collision/arenaSpatialIndexes.ts`
  - Ensure land set references revised `ARENA_WORLD_COLLIDERS`.
  - Ensure lava set includes props and non-lava blockers, with empty cliff set supported.
- Modify tests in:
  - `src/game/scenes/Arena.editor.test.ts`
  - `src/shared/balance-config/arena.test.ts`
  - `src/shared/collision/terrainHazards.test.ts`
  - `src/shared/collision/arenaSpatialIndexes.test.ts`
  - `src/shared/collision/indexedWorldCollision.test.ts`
  - impacted server/client movement, knockback, jump, and e2e tests discovered by targeted runs.

## Test Cases

- Unit: `Arena.editor.test.ts` asserts 4224x3392 base/bounds, no cliff objects, prop objects/colliders exist, exported tilemap equals committed JSON, generated non-walkable cover matches editor rectangles.
- Unit: `arena.test.ts` asserts width/height/cols/rows, non-empty lava, empty cliff, spawns are land and prop-free, at least one lava sample exists at every outer side and internal hole.
- Unit: `terrainHazards.test.ts` asserts terrain sampling returns land/lava only, `ARENA_CLIFF_COLLIDERS` empty, land world colliders exclude lava, grounded lava gate still rejects land.
- Unit: `arenaSpatialIndexes.test.ts` asserts indexed sets align with arrays and empty cliff set is valid.
- Unit/integration: movement and knockback tests assert land player can enter lava through collision, while lava player cannot walk out without current lava escape rules.
- Integration: jump landing tests assert landing in lava becomes lava and no test expects stumble/cliff.
- E2E/manual: load `/dev/phaser` or normal match route, confirm canvas nonblank, target textures loaded, arena dimensions match, no loader errors, player can reach lava.

## Warnings / Risks

- Prop instance extraction depends on pixel diff thresholds; generated review images must be inspected and tests must count/validate prop placements.
- 16px terrain quantization can slightly move visual lava edges; representative edge tests and manual play must catch bad areas.
- Many older tests use hard-coded old sample coordinates; update them to semantic sample finders where possible.
- Asset churn is large because arena base and prop PNGs are binary.
- Full e2e may require local DB/server setup and can be slow; keep exact failures in final handoff if infra blocks.

## Git & PR

**Normal execution requires a dedicated topic branch, full local verification, GitHub PR into `main`, review, merge to `main`, promotion to `prod`, and production smoke testing.** This active Codex thread is using branch `codex/no-cliff-lava-arena` in the shared workspace because the goal is already active here; do not implement on `main`.

- Default branch: `main`.
- Branch: `codex/no-cliff-lava-arena`.
- Pre-PR verification:
  - `bun run check:arena-editor-parity`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run test`
  - `bun run test:integration`
  - `bun run test:e2e`
- Before opening PR: all relevant automated suites must pass locally, or any environment blocker must be explicitly documented with exact command/output.
- Docker isolation: if local DB/Compose is needed for e2e, use a unique Compose project/network suffix for this branch and record ports/resources in handoff.
- Closure: push branch, open GitHub PR against `main`, address review, merge, then merge `main` to `prod` using repo skill `wz--pr-main-to-prod`, wait for Dokploy prod deploy, and manually smoke test prod.
- Manual local test command on completion:

```bash
cd /Users/jakemcbride/Personal/Development/wizard-wars
git fetch
git switch codex/no-cliff-lava-arena
bun run dev
```

## Scope and non-goals

- In scope: arena visuals, editor scene data, generated colliders, movement/collision rules needed for lava entry, tests, PR, prod promotion.
- Out of scope: removing `"cliff"` from public protocol/types, redesigning lava damage, changing hero animation assets, or replacing Phaser Editor workflow.

## Open questions

- None blocking. Visual content conflict resolved by actual pixels: `map-lava-with-obstacles.png` is target final visual.
