# ADR 0002: Phaser Editor Arena Compatibility

Status: Accepted
Date: 2026-04-22

## Context

The arena needs visual editing through Phaser Editor. The browser runtime also needs custom Phaser/Colyseus/gameplay logic that should survive editor-driven scene work.

## Decision

`Arena.ts` and `Arena.scene` follow the Phaser Editor `editorCreate()` pattern. `phasereditor2d.config.json` points `playUrl` to `http://localhost:3000/dev/phaser` so Phaser Editor can connect to the running Next.js dev server.

`.scene` files are committed and treated as the editor-owned source for visual scene layout. Runtime logic belongs in TypeScript around the generated/editor-compatible scene.

## Consequences

- Arena scene code must preserve the `editorCreate()` pattern.
- `.scene` JSON and `Arena.ts` must stay in sync.
- Agents should not assume procedural runtime code is visible to Phaser Editor.
- Visual scene edits should respect Phaser Editor's ownership model.

## Related Code

- `src/game/scenes/Arena.scene`
- `src/game/scenes/Arena.ts`
- `src/game/scenes/Preload.scene`
- `src/game/scenes/Boot.scene`
- `phasereditor2d.config.json`
