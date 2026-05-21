# ADR 0001: Server-Authoritative Architecture

Status: Accepted
Date: 2026-04-22

## Context

Wizard Wars is a competitive multiplayer game. Cheating or divergent client state would break movement, damage, deaths, economy, and match outcomes.

## Decision

Authoritative game logic runs on the server with bitECS at 60 Hz (`TICK_MS = 1000 / 60`). The server is the single source of truth for movement, damage, deaths, economy, and match state.

Clients run fixed-step local prediction and render interpolation for responsiveness, then reconcile against server-broadcast authoritative state. Clients do not decide authoritative outcomes.

## Consequences

- Movement and damage are harder to cheat.
- Server CPU cost is higher than a client-authoritative model.
- Client prediction, interpolation, and reconciliation are required to hide jitter.
- Lag compensation is not implemented in the MVP; this is acceptable for LAN and low-latency play until testing proves otherwise.

## Related Code

- `src/server/game/simulation.ts`
- `src/server/game/systems/**`
- `src/server/colyseus/rooms/GameLobbyRoom.ts`
- `src/game/ecs/systems/ReconciliationSystem.ts`
- `src/game/ecs/systems/PlayerRenderSystem.ts`
