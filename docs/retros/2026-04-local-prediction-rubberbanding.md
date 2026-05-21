# Local Prediction Rubberbanding Retro

Date: 2026-04
Status: Resolved

## Problem

Players saw visible local-player rubberbanding:

- While holding WASD, the sprite appeared to slide backward toward the server position.
- After releasing WASD, the sprite pulled back over the smoothing window.

The issue reproduced even when the browser and server were on the same machine, which ruled out network latency as the only cause.

## Root Causes

Three causes combined:

- Smoothing blended from stale render positions, so small reconciliation errors became visible backward motion.
- Client prediction advanced with variable render-frame delta, while server replay and reconciliation used fixed `TICK_MS`.
- Server input handling zeroed all input fields on empty-queue ticks, causing held movement to stall when RAF and server interval phase drifted.

Secondary risks included silent input queue drops under bursty/high-refresh sending and occasional large Phaser delta spikes.

## Fix

The fix established a sim/render split on the client:

- Local prediction runs in fixed `TICK_MS` steps.
- One player input is appended and sent per committed fixed sim tick.
- Rendering interpolates between committed sim states.
- Reconciliation compares against the sim state rather than the interpolated render position.
- Snap corrections collapse both previous and current sim positions to the authoritative target.

Projectile client movement was updated with the same fixed-step/render-interp pattern.

Server input handling now retains held fields across empty-queue ticks and clears only edge-triggered one-shots. `addPlayer` explicitly initializes `PlayerInput` fields so retained-input behavior cannot inherit stale bitECS array values.

## Lessons

- "Fixed the symptom" is not the same as "fixed the bug"; smoothing made the root causes visible.
- Variable-delta prediction and fixed-tick server replay drift by design.
- Per-tick network arrival is scheduling noise; held human intent should not be zeroed just because one queue tick is empty.
- bitECS typed arrays can retain old values across entity-id reuse, so server entity initialization must be explicit.
- Render interpolation between committed sim states adds about one tick of input latency at 60 Hz, which is acceptable for this game and far preferable to visible rubberbanding.

## Durable Invariant

Simulation-like client behavior should run on fixed steps. Cosmetic VFX can remain variable-delta unless a concrete bug says otherwise.

## Code Anchors

- `src/game/ecs/systems/PlayerRenderSystem.ts`
- `src/game/ecs/systems/ReconciliationSystem.ts`
- `src/game/ecs/systems/ProjectileRenderSystem.ts`
- `src/game/ecs/systems/NetworkSyncSystem.ts`
- `src/game/scenes/ArenaRuntime.ts`
- `src/server/game/systems/inputSystem.ts`
- `src/server/game/simulation.ts`
- `src/server/colyseus/rooms/GameLobbyRoom.ts`
- `src/shared/balance-config/rendering.ts`

## Source

Extracted from Obsidian note `learnings/2026-04-local-prediction-rubberbanding.md`.
