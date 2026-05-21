# Browser Game Research Conclusions

This file extracts durable engineering conclusions from Obsidian research notes. It is intentionally concise; raw source links, lane notes, and long-form synthesis stay in Obsidian.

## Netcode

There is no drop-in "Phaser + bitECS + Colyseus" netcode product. Treat the problem as solved at the concept level, not the library level:

- Use Gambetta/Gaffer-style client prediction, reconciliation, entity interpolation, and fixed timesteps as the conceptual spine.
- Use Colyseus for rooms, messages, state/schema, and simulation interval, but do not assume it supplies a full prediction framework.
- Use bitECS for packed simulation state and server systems, but audit entity-id reuse and serialization assumptions before relying on diffing or snapshots.
- Fixed-step simulation and variable-delta rendering are an invariant for local feel.

Source: Obsidian `learnings/2026-04-netcode-prior-art-phaser-bitecs-colyseus.md`.

## Top-Down Jump

Jump should keep `x/y` as the authoritative ground footprint and model height separately:

- Server owns `jumpZ`/airborne state and terrain interaction.
- Rendering offsets the sprite from the ground point while shadow/footprint communicates the true position.
- Airborne players can ignore floor hazards such as lava, while still interacting with solids and attacks according to explicit rules.
- Landing checks should decide whether the footprint lands on safe terrain or a hazard.

Source: Obsidian `research/2026-04-30-top-down-2d-jump-pixel-art-hitboxes.md`.

## Telegraphs

Readable combat telegraphs should be server-seeded and client-rendered:

- Prefer shared shape vocabulary such as cone, capsule, circle, and ring where it reduces duplication.
- Replicate start time, duration, phase timing, origin/anchor, aim direction, and shape dimensions from server-owned state.
- Avoid client-local raycast-only or aim-only logic for anything that affects damage.
- Balance clarity against clutter; not every instant or tiny action needs a heavy ground overlay.

Source: Obsidian `research/2026-04-30-visual-telegraphs-for-abilities.md` and `decisions/0012-combat-telegraphs-and-generic-hurtboxes.md`.

## Melee Hitboxes

The durable migration path is data-driven attack volumes:

- Author hitbox/hurtbox data as deterministic gameplay data, not as Phaser runtime physics.
- Server samples attack instances by attack id and elapsed tick/frame, then queues normal damage events.
- Track hit-once keys such as `(attackInstanceId, targetEid, hitGroupId)` to avoid accidental repeated damage.
- Add server-side rewind only later if latency playtests prove current-state melee feels unfair.

Source: Obsidian `research/2026-04-27-server-authoritative-melee-hitboxes.md`.

## Backgrounds And Tilemaps

For browser/Phaser delivery, use a hybrid approach:

- Tilemaps remain best for procedural dungeons and collision-rich reusable content.
- Hand-painted or highly unique scenes can use pre-rendered PNG chunks treated like oversized tiles.
- Keep chunks within conservative texture-size limits, preferably 2048x2048 for broad device safety.
- Runtime cost of a few uploaded chunks is usually low; memory, decode/upload time, and authoring iteration are the real costs.
- Keep collision/pathfinding data separate from purely visual background chunks.

Source: Obsidian `research/2026-04-27-prerendered-vs-tilesheets-2d-backgrounds.md`.

## Audio Library

For the current scale, stay lightweight:

- Track game audio cues through named asset keys, source files, and mirrored folder conventions.
- Keep licensing/source records for third-party audio.
- Separate BGM and SFX ownership in code and settings.
- FMOD/Wwise-level middleware is not justified until adaptive music, banks, or broader team handoff create real pressure.

Source: Obsidian `research/2026-05-04-indie-sound-library-management.md`.

## Weapon Customization

For many weapons without animation explosion, prefer data-driven compositing:

- Hardpoint/separate-sprite compositing lets one body animation render many weapon sprites.
- Floating-hands patterns use per-weapon hand coordinates and z-order rules.
- Paper-doll/layered sprites work when all layers share frame counts and direction layouts.
- Skeletal/shader systems are powerful but add pipeline complexity that should be justified by content scale.

Source: Obsidian `research/2026-05-16-pixel-art-weapon-customization-floating-hands.md`.
