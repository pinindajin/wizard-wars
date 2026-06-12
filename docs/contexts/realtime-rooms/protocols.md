# Realtime Protocols

Durable summary of the Colyseus event protocol. The source-of-truth event constants and payload types live in `src/shared/roomEvents.ts`, `src/shared/events.ts`, `src/shared/types.ts`, and `src/shared/validators.ts`.

## Event Vocabularies

- `RoomEvent` values are the snake_case Colyseus wire strings, such as `lobby_state` and `player_input`.
- `WsEvent` values are SCREAMING_SNAKE labels used where label-style event names are useful for logs/tests.
- `roomToWsEvent` and `wsToRoomEvent` bridge between the two vocabularies.

When adding a room event, update the shared event constant, payload type, validator where needed, and bridge mapping if the event also needs a `WsEvent` label.

## Lobby Events

| Event | Direction | Purpose |
| --- | --- | --- |
| `lobby_state` | Server to clients | Full lobby roster/phase snapshot. |
| `lobby_chat` | Client to server, server to clients | Lobby chat message. |
| `lobby_chat_history` | Server to joiner | Buffered lobby chat history. |
| `lobby_start_game` | Host client to server | Request transition from lobby to loading/countdown. |
| `lobby_end_game` | Host client to server | Request end of in-progress game. |
| `lobby_countdown` | Server to clients | Lobby countdown before game start. |
| `lobby_host_transfer` | Server to clients | New host assignment. |
| `lobby_hero_select` | Client to server, server to clients | Selected hero update. |
| `lobby_scoreboard` | Server to clients | End-of-match scoreboard payload. |
| `lobby_scoreboard_countdown` | Server to clients | Return-to-lobby countdown. |
| `lobby_return_to_lobby` | Client to server | Client is ready to leave scoreboard. |
| `lobby_kicked` | Server to client | Client removal reason. |
| `lobby_error` | Server to client | Recoverable lobby error. |
| `lobby_end_lobby` | Server to clients | Lobby teardown notice. |
| `lobby_admin_closing` | Server to clients | Admin close warning/countdown. |

## Loading Gate Events

| Event | Direction | Purpose |
| --- | --- | --- |
| `client_scene_ready` | Client to server | Phaser Arena scene loaded and ready. |
| `match_countdown_start` | Server to clients | Server-synced countdown start time and duration. |
| `match_go` | Server to clients | Server sim and client input unfreeze. |

## Game Events

| Event | Direction | Purpose |
| --- | --- | --- |
| `player_input` | Client to server | Fixed-step player intent payload. |
| `player_join` | Server to clients | Player entered match. |
| `player_leave` | Server to clients | Player exited match. |
| `player_batch_update` | Server to clients | Player deltas, removals, and sequence. |
| `game_state_sync` | Server to client | Full authoritative state hydration. |
| `player_death` | Server to clients | Death event. |
| `player_respawn` | Server to clients | Respawn event. |
| `request_resync` | Client to server | Request full state resync after a gap. |
| `fireball_launch` | Server to clients | Fireball spawn/VFX event. |
| `fireball_impact` | Server to clients | Fireball impact/VFX event. |
| `fireball_batch_update` | Server to clients | Fireball deltas/removals. |
| `homing_orb_launch` | Server to clients | Homing Orb spawn/VFX event with owner, target, velocity, heading, and expiry time. |
| `homing_orb_impact` | Server to clients | Homing Orb hit or expiry VFX/SFX event. |
| `homing_orb_batch_update` | Server to clients | Homing Orb position, velocity, heading deltas, and removals. |
| `lightning_bolt` | Server to clients | Lightning bolt VFX/damage event. |
| `primary_melee_attack` | Server to clients | Primary melee swing event. |
| `combat_telegraph_start` | Server to clients | Start a client-rendered telegraph. |
| `combat_telegraph_end` | Server to clients | End/cancel a client-rendered telegraph. |
| `ability_sfx` | Server to clients | Ability sound cue. |
| `damage_float` | Server to clients | Floating combat text and local hit feedback. |
| `server_performance_status` | Server to clients | Server loop health snapshot for client warning indicators and operator diagnostics. |

## Shop Events

| Event | Direction | Purpose |
| --- | --- | --- |
| `shop_purchase` | Client to server | Purchase an item by id. |
| `shop_state` | Server to client | Current session economy/inventory/loadout. |
| `shop_error` | Server to client | Purchase/assignment failure. |
| `gold_balance` | Server to client | Session gold update. |
| `assign_ability` | Client to server | Assign owned ability to slot 0-4. |
| `use_quick_item` | Client to server | Consume quick-item slot Q/6/7/8. |

## Chat Events

| Event | Direction | Purpose |
| --- | --- | --- |
| `chat_message` | Client to server, server to clients | Global chat message in `ChatRoom`. |
| `chat_presence` | Server to clients | Global chat presence snapshot. |

## Protocol Invariants

- Server remains authoritative for match state and combat outcomes.
- Clients may render telegraphs and VFX from server-seeded timing/geometry, but they do not decide damage.
- Input payloads are sequence-numbered, validated by the room, queued per player, capped, and consumed by the simulation at most once per player per tick.
- Player and fireball movement deltas may be cadence-limited by `WW_NET_SEND_RATE_HZ`, but owner ACKs, full syncs, death/respawn, shop/economy, ability SFX, combat events, and performance status are sent immediately.
- `game_state_sync` includes active `fireballs` and `homingOrbs` so reconnecting clients can rebuild projectile sprites immediately.
- `lastProcessedInputSeq` advancement is not allowed to wait for the visual delta cadence; when needed, the owner receives a minimal ACK-only player delta.
- `server_performance_status` is emitted on degraded-state changes, or at most once per second while degraded. Its `server_cpu` client indicator name is retained for parity with Seas of Aleryn, but the signal means "server loop degraded".
- Full hydration should include enough lobby/shop/game state for reconnect and resync paths to recover without relying on stale client memory.
