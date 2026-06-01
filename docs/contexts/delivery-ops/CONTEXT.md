# Delivery Ops Context

## Purpose

Own local setup, CI, container build/runtime, production image publishing, deployment hooks, environment samples, and operational scripts.

## Owned Concepts

- Package scripts and task expectations in `package.json`.
- Dockerfile and docker-compose services for local and production-like runs.
- GitHub Actions CI for PRs to `main` and `prod`.
- Production image publishing from `prod` to GHCR.
- Dokploy deploy trigger and Render fallback blueprint.
- Prisma migration execution in CI and container startup.
- Environment sample files and deployment variables.
- Asset/build scripts and developer orchestration scripts.

## Key Flows

- Local hybrid dev uses `bun run dev:hybrid`, which starts Docker Postgres services and the Bun/Next/Colyseus server.
- PR CI runs unit coverage, fast integration, slow integration with Postgres, and production-build Playwright E2E.
- Pushes to `prod` run lint, typecheck, coverage, integration, build, E2E, Docker build/push to `ghcr.io/pinindajin/wizard-wars`, then trigger Dokploy deployment.
- Docker runtime starts by applying Prisma migrations with the platform-provided `DATABASE_URL`, then runs `bun run start`.
- Render remains represented by `render.yaml` as a fallback host.
- Runtime netcode sends visual movement/projectile batches at `WW_NET_SEND_RATE_HZ` with default `30` and clamp range `10..60`; set `WW_NET_SEND_RATE_HZ=60` as the first rollback lever for cadence-related smoothness regressions.
- Production rubber-banding investigations should record image digest, Dokploy image, replica count, resource limits, cgroup throttling, active rooms, and server loop-debt/performance-status logs in `docs/contexts/delivery-ops/prod-rubberbanding-verification.md`.

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
