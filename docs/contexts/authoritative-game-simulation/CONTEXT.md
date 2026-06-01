# Authoritative Game Simulation Context

## Purpose

Own the server-side game engine. This context is the final source of truth for movement, combat, damage, deaths, economy, respawn, match-end conditions, and gameplay state transitions.

## Owned Concepts

- bitECS world, components, tags, and system pipeline.
- Per-tick simulation at 60 Hz (`TICK_MS = 1000 / 60`).
- Player input consumption, held-vs-edge input semantics, and command buffering.
- Movement, collision, jump physics, terrain hazards, knockback, projectiles, melee, lightning, casting, health, death, lives/respawn, economy, match end, and deltas.
- Session-only economy/loadout state applied to ECS during matches.
- Server-generated sync payloads and authoritative deltas.

## Key Flows

- `GameLobbyRoom` queues validated `player_input` payloads, then calls `simulation.tick(inputQueue)` once per server tick while a match is in progress.
- Each tick runs the pipeline in order: input, casting, movement, knockback, player collision, world collision, jump physics, terrain hazards, projectile movement, melee, lightning, projectile collision, health, death, lives/respawn, economy, match end, command buffer, and delta systems.
- Server systems queue commands/events; the command buffer materializes deferred effects at deterministic points.
- Simulation builds hydration payloads for reconnect/resync and emits deltas/events back through the room.

## Boundaries

- Does not own WebSocket session lifecycle, lobby FSM, host permissions, room disposal, or reconnect grace. Those belong to `realtime-rooms`.
- Does not import Phaser/client code.
- Uses shared contracts and constants from `shared-game-contracts-and-rules`; do not duplicate balance constants.
- Persistence is out of scope for match runtime state; match economy/inventory/loadout are session-only unless a future ADR changes that.

## Code Anchors

- `src/server/game/**`
- `src/server/gameserver/sessionShop.ts`
- `src/server/colyseus/rooms/GameLobbyRoom.ts` only at the bridge where it drives ticks and applies room inputs.
- `src/shared/balance-config/**`
- `src/shared/collision/**`

## Related Docs

- `docs/adr/0001-server-authoritative.md`
- `docs/adr/0009-tdd-discipline.md`
- `docs/adr/0012-combat-telegraphs-and-generic-hurtboxes.md`
- `docs/retros/2026-04-local-prediction-rubberbanding.md`
- `docs/roadmaps/architecture-improvement.md`
- `docs/contexts/browser-game-client/research-conclusions.md`
