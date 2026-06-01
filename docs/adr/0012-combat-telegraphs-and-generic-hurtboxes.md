# ADR 0012: Combat Telegraphs And Generic Hurtbox Shapes

Status: Accepted
Date: 2026-04-30

## Context

Wizard Wars needs readable ground telegraphs for attacks and spells while keeping damage server-authoritative. Primary melee already resolves with a cone-shaped hurtbox during a dangerous window. Lightning Bolt resolves with a capsule-style line segment plus radius and should become a committed aimed spell.

## Decision

Authority split:

- Server remains authoritative for damage.
- Clients render telegraphs from server-seeded metadata and shared balance config.

Generic hurtbox shape vocabulary:

- `cone` for primary melee and future arc attacks.
- `capsule` for Lightning Bolt and future line attacks.
- Shape descriptors should be shared between server damage checks, client telegraph rendering, and dev-tool previews where practical.

Primary melee telegraph:

- Anchor follows caster position.
- Facing is locked at attack start.
- Telegraph is visible from swing start through dangerous-window end.
- Windup and danger phases use distinct fill treatment.
- Telegraph is removed when the dangerous window ends.

Lightning Bolt:

- Mouse click chooses aim direction at cast start.
- WASD movement is rooted during the cast, but knockback may still move the caster.
- Aim direction is locked at click as a world-space direction.
- Telegraph and damage capsule track caster position if knockback moves the caster.
- Damage resolves at effect time using current caster position plus locked direction.
- Death or spectator transition cancels the cast and removes the telegraph.

Network model:

- Use generic combat telegraph start/end payloads for spells/attacks that cannot be inferred from visible state alone.
- Include caster id, source id, shape, live anchor id, locked direction, dimensions, and server-time phase boundaries.
- Full state sync should include active telegraph metadata.

## Consequences

- Damage remains cheat-resistant and server-authoritative.
- Clients need enough cast-start data to draw warnings before damage.
- Lightning reads as a committed spell while still reacting to knockback.
- Shared shape vocabulary reduces duplication but must stay thin enough to avoid over-generalizing unique attacks.
- Primary melee should migrate to generic `cone` descriptors without changing current server behavior.

## Related Code

- `src/server/game/combatTelegraphs.ts`
- `src/game/ecs/systems/CombatTelegraphRenderSystem.ts`
- `src/server/game/systems/lightningBoltSystem.ts`
- `src/server/game/systems/primaryMeleeAttackSystem.ts`
- `src/shared/balance-config/telegraphs.ts`
- `src/shared/roomEvents.ts`
