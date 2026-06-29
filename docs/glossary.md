# Wizard Wars Glossary

Cross-context vocabulary for active engineering work.

| Term | Definition |
| --- | --- |
| Arena | Playfield for a match. Current arena is a native image-backed 2804x2244 px map with editor-authored prop, cliff, lava, and walkable regions. |
| Hero | Player avatar. Current MVP heroes share the lady-wizard sprite and differ through identity/config rather than separate art. |
| Lives | Respawn tickets. A player who reaches zero lives becomes a spectator; the match ends when eliminations leave one or zero active players. |
| Kill | Lethal damage event. The killer receives kill credit and session gold. |
| Respawn | Return to play after death delay at a selected safe spawn point. |
| Spectator | Player with zero lives. Cannot act, but does not by itself end a larger multiplayer match. |
| DamageProperty | Bitmask describing damage traits such as physical, magic, slashing, fire, or electric. |
| Knockback | Displacement impulse applied by abilities or impacts and clamped by world collision. |
| Quick | Ability config flag retained on casting. Movement during cast is controlled by `castMoveSpeedMultiplier`. |
| Casting | Server component/state for an active ability animation/timing window. |
| SwingingWeapon | Legacy server tag for primary melee swing behavior. |
| InvulnerableTag | Temporary post-spawn immunity. |
| DamageFlashTag | Short damage-hit visual feedback tag. |
| `ww-token` | HttpOnly JWT auth cookie for browser sessions. |
| Loading Gate | Match phase where clients load the Arena scene before countdown. |
| Countdown Overlay | Server-timestamped "3, 2, 1, GO" UI before match input starts. |
| MatchGo | Colyseus event that unfreezes server simulation and client input. |
| Gold | Session currency. Starts fresh each match and is not persisted to the DB. |
| Ability Slot | One of five active ability slots. |
| Quick-Item Slot | Consumable quick item slot, currently mapped to Q/6/7/8. |
| Kill Feed | HUD list of recent kills. |
| Name Tag | Username and HP bar above each player sprite. |
| Y-sort | Render ordering by sprite `y`, with player/tall prop origin at `(0.5, 1.0)`. |
| Rocket-jump | Emergent fireball self-damage plus self-knockback movement. |
| BGM | Background music. |
| Lobby Mute | Lobby-specific mute state stored under `ww-lobby-muted`. |

When adding or renaming domain concepts, update this glossary and the relevant context doc together.
