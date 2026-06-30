# ADR 0011: Animation Tool Sprite Sheet Replace

Status: Accepted
Date: 2026-04-30

## Context

Artists need to swap individual hero direction strips from `/dev/animation-tool` without leaving the dev UI or manually editing megasheets. Strips must stay aligned with `atlas.json` frame counts. Per-frame PNGs must stay consistent so sheet rebuild scripts do not clobber edits.

## Decision

Add dev-only HTTP endpoints:

- `POST /api/dev/animation-tool/replace-sheet`: multipart upload, Sharp validation, archive prior strip and frames under gitignored `old/` trees, and stage-temp atomic rename behavior.
- `POST /api/dev/animation-tool/rebuild-megasheet`: calls the exported megasheet builder in process.

Processing order:

1. Validate and slice uploaded PNG into temporary frames.
2. Swap strip.
3. Swap frames.

Validation or slice failures must not mutate live committed strips.

`atlas.json` is immutable for this feature. Missing direction entries disable Replace with an explanation rather than creating new atlas entries.

Client behavior:

- Render per-direction Replace controls.
- Pre-validate image dimensions where possible.
- Cache-bust the changed strip after success.
- Show a stale-megasheet indicator and manual rebuild button.
- Scope sprite replacement and megasheet rebuilds to the selected hero.

Testing:

- Route integration tests for replace and rebuild.
- Extracted client helpers tested with Vitest/jsdom.
- Production-build Playwright can reach dev-tool paths only through explicit E2E bypass gates.

## Consequences

- Manual megasheet rebuild remains an operator action.
- Local archives grow under gitignored `old/` directories and need periodic manual pruning.
- Hero sprite clip IDs, paths, and UI selection are generalized through the shared hero sprite registry.
- Real production hosts must not set E2E bypass variables.

## Related Code

- `src/app/dev/animation-tool/**`
- `src/app/api/dev/animation-tool/**`
- `src/shared/sprites/heroSprites.ts`
- `scripts/build-hero-megasheet.ts`
- `src/shared/dev/animationToolE2eGate.ts`
