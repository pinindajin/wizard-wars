# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root. It defines this repo's domain contexts and points at the context docs relevant to each area.
- **The relevant context `CONTEXT.md` file** listed in `CONTEXT-MAP.md` for the code or issue being touched.
- **`docs/adr/`** for system-wide decisions that touch the area you're about to work in.
- **`docs/contexts/<context>/adr/`** for context-specific decisions, when that directory exists.

If any of these files don't exist, proceed silently. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## Context layout

This is a multi-context repo. The root `CONTEXT-MAP.md` lists these contexts:

- `web-app-ui`: login, signup, protected app routes, global lobby, lobby screens, game HUD/shell React UI, shared app UI styling.
- `browser-game-client`: Phaser runtime, render ECS, input, audio, minimap, client networking, prediction, reconciliation, and interpolation.
- `shared-game-contracts-and-rules`: artifacts that must mean the same thing on client and server, including shared configs, collision helpers, keybind/settings schemas, sprite metadata, and cross-boundary contracts.
- `authoritative-game-simulation`: server-side truth for movement, combat, projectiles, hazards, match lifecycle, lives/respawn, economy, and simulation tests.
- `realtime-rooms`: Colyseus rooms, room lifecycle, lobby/game connection orchestration, and realtime session wiring.
- `web-backend-platform`: Bun/Express/Next server, HTTP API routes, tRPC, auth, persistence, admin/dev endpoints, and database integration.
- `delivery-ops`: Docker, deployment, CI, environment setup, migrations, scripts, and test command workflows.

## Use the glossary's vocabulary

When your output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use, or there's a real gap to note for `/grill-with-docs`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
