# Delivery Ops Context

## Purpose

Own local setup, CI, container build/runtime, production image publishing, deployment hooks, environment samples, and operational scripts.

## Owned Concepts

- Package scripts and task expectations in `package.json`.
- Dockerfile and docker-compose services for local and production-like runs, including split web/realtime roles.
- GitHub Actions CI for PRs to `main` and `prod`.
- Production image publishing from `prod` to GHCR.
- Dokploy deploy trigger and Render fallback blueprint.
- Prisma migration execution in CI and container startup.
- Environment sample files and deployment variables.
- Asset/build scripts and developer orchestration scripts.

## Key Flows

- Local hybrid dev uses `bun run dev:hybrid`, which starts Docker Postgres services and the Bun/Next/Colyseus single-process fallback.
- Full Docker compose runs separate `app` (`WW_SERVER_MODE=web`) and `realtime` (`WW_SERVER_MODE=realtime`) services; browser clients use `NEXT_PUBLIC_COLYSEUS_URL` and web admin routes use `WW_REALTIME_ADMIN_URL`.
- `NEXT_PUBLIC_COLYSEUS_URL` must be supplied before Docker/Next build as well as at runtime, because Next inlines public env values into browser bundles.
- PR CI runs unit coverage, fast integration, slow integration with Postgres, and production-build Playwright E2E.
- Pushes to `prod` run lint, typecheck, coverage, integration, build, E2E, Docker build/push to `ghcr.io/pinindajin/wizard-wars`, then trigger Dokploy deployment.
- Docker runtime applies Prisma migrations only when `RUN_MIGRATIONS=true`; realtime defaults false so it does not race the web/migration owner.
- Render remains represented by `render.yaml` as a fallback host.
- Runtime netcode sends visual movement/projectile batches at `WW_NET_SEND_RATE_HZ` with default `30` and clamp range `10..60`; set `WW_NET_SEND_RATE_HZ=60` as the first rollback lever for cadence-related smoothness regressions.
- Production rubber-banding investigations should record image digest, Dokploy image, replica count, resource limits, repeated Docker stats, cgroup throttling deltas, active rooms, and server loop-debt/performance-status logs in `docs/contexts/delivery-ops/prod-rubberbanding-verification.md`.
- Keep realtime replica count at 1 until sticky routing plus shared Colyseus Presence/Driver are designed and tested.

## Boundaries

- Does not define gameplay or app behavior; it verifies and ships it.
- Does not store production secrets in repo docs or sample env files.
- If a workflow changes test expectations, also update the affected context docs and README/script docs.
- Keep Docker/CI Node/Bun versions aligned with package manager expectations.

## Code Anchors

- `.github/workflows/**`
- `Dockerfile`
- `docker-compose.yml`
- `render.yaml`
- `sample.env`
- `sample.env.docker`
- `package.json`
- `scripts/**`
- `playwright.config.ts`
- `vitest*.config.ts`
- `prisma/**`
- `docs/contexts/delivery-ops/prod-rubberbanding-verification.md`

## Related Docs

- `docs/adr/0009-tdd-discipline.md`
- `docs/adr/0010-structured-logging-observability-roadmap.md`
- `docs/contexts/web-backend-platform/CONTEXT.md`
