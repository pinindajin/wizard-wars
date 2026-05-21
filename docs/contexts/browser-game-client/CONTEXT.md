# Browser Game Client Context

## Purpose

Own the Phaser 4 runtime that renders the match in the browser and makes local play feel responsive while staying subordinate to the server-authoritative simulation.

## Owned Concepts

- Phaser scene lifecycle: Boot, Preload, Arena, and Phaser Editor compatible scene files.
- Client ECS/render systems: player/projectile rendering, telegraph rendering, hit feedback, debug overlays, minimap, damage floaters, lightning, and other visual systems.
- Input collection and gating: keyboard, mouse, gameplay-input blocking, local input history, and fixed-step input send cadence.
- Client prediction and reconciliation: local fixed-step sim, pending input replay, server ACK handling, smoothing/snap classification, and remote interpolation.
- Game audio: battle BGM, lobby/game SFX playback hooks, footstep gates, hit feedback, ability SFX, and local preview behavior.
- Phaser dev tooling routes when they exercise the browser runtime, including `/dev/phaser` and sprite/animation preview surfaces.

## Key Flows

- `LobbyGameHost` mounts the Phaser game factory, which creates Boot/Preload/Arena scenes.
- Arena connects to a `GameConnection`, subscribes to room events, sends one `player_input` per committed fixed sim tick, and applies server broadcasts.
- Local movement is predicted in fixed `TICK_MS` chunks, rendered with interpolation between committed sim states, and reconciled against `lastProcessedInputSeq`.
- Remote players are rendered from the interpolation buffer rather than from local prediction.
- Visual events such as fireball launch/impact, melee swing, lightning, combat telegraphs, damage floats, and ability SFX are server-seeded but client-rendered.

## Boundaries

- Does not decide damage, economy, deaths, respawns, match end, or legal movement.
- Does not own the Colyseus room FSM or message validation.
- Shared constants and protocol types must come from `shared-game-contracts-and-rules`; avoid copying values into client-only code.
- Phaser Editor `.scene` files are source material for visual layout; do not assume runtime code can replace editor-owned scene data without updating the editor contract.

## Code Anchors

- `src/game/**`
- `src/app/(protected)/lobby/[id]/game/**`
- `src/lib/fetch-ws-auth-token.ts`
- `src/lib/parse-ws-auth-session.ts`
- `public/assets/**`
- `phasereditor2d.config.json`
- `src/index.html`

## Related Docs

- `docs/adr/0001-server-authoritative.md`
- `docs/adr/0002-phaser-editor-arena.md`
- `docs/adr/0011-anim-tool-sheet-replace.md`
- `docs/adr/0012-combat-telegraphs-and-generic-hurtboxes.md`
- `docs/adr/2026-05-04-walk-footstep-gates.md`
- `docs/retros/2026-04-local-prediction-rubberbanding.md`
- `docs/contexts/browser-game-client/research-conclusions.md`
