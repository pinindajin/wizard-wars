# Shared Game Contracts And Rules Context

## Purpose

Own TypeScript contracts and shared deterministic rules that must mean the same thing on the browser client, realtime rooms, and authoritative server simulation.

## Owned Concepts

- Wire event names and cross-event mappings.
- Payload and validator schemas.
- Balance constants for abilities, animation timing, arena geometry, audio, combat, economy, heroes, items, lobby, rendering, telegraphs, camera, and settings.
- Shared collision and terrain helpers.
- Keybind, settings, sprite, logging, dev/E2E access, and domain type contracts.
- Generated arena layout/collider data consumed by both server and client.

## Key Flows

- A new room event starts here: add the `RoomEvent` value, payload type, validators where needed, and `WsEvent` bridge only if a label-style event is also needed.
- Gameplay constants are authored in shared balance config so server systems and client renderers agree on timing, geometry, and presentation-critical values.
- Collision helpers used in prediction must stay behaviorally aligned with server collision rules.
- Animation config and sprite metadata are shared by the animation tool, Phaser runtime, and server timing consumers.

## Boundaries

- Shared modules must not import from `src/server/**`, `src/game/**`, or `src/app/**`.
- Shared code can define rules and contracts, but authoritative outcomes are still produced in `authoritative-game-simulation`.
- Shared presentation constants are acceptable when they are part of a client/server contract, but purely local UI styling belongs to `web-app-ui` or `browser-game-client`.
- Keep registries and config data deterministic at import time; avoid runtime side effects that make tests order-dependent.

## Code Anchors

- `src/shared/**`
- `src/shared/balance-config/**`
- `src/shared/collision/**`
- `src/shared/roomEvents.ts`
- `src/shared/events.ts`
- `src/shared/validators.ts`
- `src/shared/types.ts`

## Related Docs

- `docs/contexts/realtime-rooms/protocols.md`
- `docs/contexts/browser-game-client/research-conclusions.md`
- `docs/adr/0001-server-authoritative.md`
- `docs/adr/0012-combat-telegraphs-and-generic-hurtboxes.md`
- `docs/adr/2026-05-04-walk-footstep-gates.md`
