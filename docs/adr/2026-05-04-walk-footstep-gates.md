# ADR 2026-05-04: Walk Footstep SFX Gates And Cadence

Status: Accepted
Date: 2026-05-04

## Context

Walk footstep audio should give the local player movement feedback without creating a noisy 12-player mix or coupling cosmetic audio too tightly to server simulation internals.

## Decision

Local-only walk footsteps use TomMusic Dirt assets:

- `dirt-walk-2.wav` for step.
- `dirt-jump.wav` for jump.

Walk steps repeat at `WALK_FOOTSTEP_INTERVAL_MS`, half of the configured walk loop duration in `animation-config.json`.

Footstep timer advances only when all gates pass:

- Non-zero WASD intent from `normalizedMoveFromWASD`.
- `jumpZ === 0`.
- Animation state is not `dying` or `dead`.
- Move state is not `rooted`.

The gate intentionally does not depend on prediction, cast move multipliers, or melee swing speed. Remote players do not play footstep SFX.

## Consequences

- Local player gets readable movement audio.
- Audio remains decoupled from simulation timing.
- Keys held against walls may still tick steps until stricter movement-result gates are added.
- Remote footstep mix is avoided.

## Related Code

- `src/shared/balance-config/audio.ts`
- `src/shared/balance-config/walkFootstepTimer.ts`
- `src/game/audio/WalkFootstepController.ts`
- `src/game/scenes/ArenaRuntime.ts`
- `public/assets/arena-asset-pack.json`
