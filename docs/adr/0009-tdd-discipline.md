# ADR 0009: TDD Discipline

Status: Accepted
Date: 2026-04-22

## Context

Complex game simulation logic is easy to regress. Combat, collision, economy, input handling, and reconciliation all have edge cases that are hard to validate by inspection alone.

## Decision

Test-Driven Development is mandatory for feature and bugfix work whenever practical:

1. Write a failing test.
2. Confirm it fails.
3. Write the minimum code to pass.
4. Refactor with tests green.

When TDD is truly impractical, such as Phaser rendering probes, tilemap JSON wiring, or asset-pack registration, document the exception in the PR body under `## TDD Exceptions` and provide compensating verification.

## Consequences

- Development is slower at the start, but simulation stability is much higher.
- bitECS systems should have unit tests for happy paths, edge cases, and boundaries.
- UI/dev-tool changes should use focused unit/integration/E2E coverage where TDD is possible.
- Exceptions are allowed, but they must be explicit and justified.

## Related Code

- `vitest.config.ts`
- `vitest.integration.fast.config.ts`
- `vitest.integration.slow.config.ts`
- `playwright.config.ts`
- `tests/e2e/**`
