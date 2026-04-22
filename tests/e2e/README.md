# E2E Tests

End-to-end tests under `tests/e2e/` run headless Chromium via **Playwright**.

## Running locally

Prerequisites:

1. Postgres running: `bun run docker:up:db`
2. Migrations applied: `bunx prisma migrate deploy`
3. Chromium installed (first time only): `bunx playwright install chromium`
4. Next.js built: `bun run build`

Then:

```bash
DATABASE_URL=postgresql://ww_user:ww_pass@localhost:5433/wizardwars \
AUTH_SECRET=test-secret-32-chars-minimum-required \
bun run test:e2e
```

Playwright will start `bun run start` automatically (via `webServer` in `playwright.config.ts`),
run the spec, and shut the server down on completion.

If you already have `bun run start` running on port 3000 with the right `DATABASE_URL` and
`AUTH_SECRET`, the test will reuse that server (the `reuseExistingServer` option is enabled
outside CI).

## CI

The E2E job runs **only** on pull requests whose base branch is `prod`, and on direct pushes
to `prod`. It does **not** run on `main` PRs — this keeps the main PR cycle fast.

To see E2E run on CI, open a PR targeting the `prod` branch.

## Adding new specs

Drop a `*.spec.ts` file under `tests/e2e/`. The `playwright.config.ts` picks up all
`*.spec.ts` files in this directory automatically. No config changes needed.

## Current specs

| File | What it tests |
|---|---|
| `signup.spec.ts` | Happy-path account creation: `/signup` → fills form → redirected to `/home` → `ww-token` cookie set |
