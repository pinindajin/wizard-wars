# Realtime Rooms Context

## Purpose

Own Colyseus room lifecycle, realtime session orchestration, lobby/match phase transitions, room event delivery, reconnect handling, and the bridge between connected clients and the authoritative simulation.

## Owned Concepts

- `ChatRoom` global chat/presence behavior.
- `GameLobbyRoom` roster, host, hero select, lobby chat, idle/close behavior, countdowns, loading gate, scoreboard, reconnect grace, and room disposal.
- Colyseus authentication and join options.
- Per-player input queues and queue caps before simulation ticks consume inputs.
- Room event emission and hydration/resync orchestration.
- Admin lobby snapshots and close-lobby controls.

## Key Flows

- Browser clients join a `game_lobby` room with a verified token and become lobby roster entries.
- Host starts the match, which moves the room through `LOBBY`, `WAITING_FOR_CLIENTS`, `COUNTDOWN`, `IN_PROGRESS`, `SCOREBOARD`, and back to `LOBBY`.
- During `IN_PROGRESS`, the room runs the simulation interval and broadcasts simulation output through `RoomEvent` payloads.
- Reconnect/drop paths preserve roster state during the reconnect window and clean up indexes when players truly leave.
- Room hydration sends lobby state, shop state, and full game state when clients request resync or join in progress.

## Boundaries

- Does not own the internal game rules that decide movement, damage, economy, or death. It calls into `authoritative-game-simulation`.
- Does not own the shape of shared event payloads; those live in `shared-game-contracts-and-rules`.
- Does not own HTTP route auth or persistence outside room lifecycle. Those belong to `web-backend-platform`.
- Avoid putting React/Phaser-specific assumptions into room state; rooms should speak shared payload contracts.

## Code Anchors

- `src/server/colyseus/**`
- `src/server/colyseus/rooms/ChatRoom.ts`
- `src/server/colyseus/rooms/GameLobbyRoom.ts`
- `src/shared/roomEvents.ts`
- `src/shared/types.ts`
- `src/shared/validators.ts`

## Related Docs

- `docs/contexts/realtime-rooms/protocols.md`
- `docs/adr/0001-server-authoritative.md`
- `docs/adr/0012-combat-telegraphs-and-generic-hurtboxes.md`
- `docs/retros/2026-04-local-prediction-rubberbanding.md`
