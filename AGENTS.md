# Wizard Wars — Agent Instructions

## Cursor Cloud specific instructions

### Services overview

| Service | Purpose | How to start |
|---------|---------|-------------|
| PostgreSQL (db + db-shadow) | Primary DB + Prisma shadow DB | `docker compose up -d --wait db db-shadow` |
| App server (Next.js + Colyseus) | Web frontend + game server on port 3000 | `node ./node_modules/.bin/tsx server.ts` |

### Critical startup caveats

1. **Turbopack requires `node` in a standard system PATH.** The SWC native addon spawns node worker processes via `posix_spawnp`. Ensure `/usr/local/bin/node` or `/usr/bin/node` symlinks exist pointing to the active Node.js binary (e.g., `sudo ln -sf $(which node) /usr/local/bin/node`).

2. **Do NOT use `bun run dev` in Cloud Agent VMs.** The `bun` script runner strips or modifies environment variables that Turbopack's Rust binary needs to spawn its PostCSS worker pool. Instead, run the dev server directly:
   ```bash
   node ./node_modules/.bin/tsx server.ts
   ```

3. **Docker must be running** before starting the app server — the PostgreSQL containers must be healthy. Start Docker daemon with `sudo dockerd &>/tmp/dockerd.log &` if not already running, then fix socket permissions: `sudo chmod 666 /var/run/docker.sock`.

4. **Docker in Cloud Agent VMs** needs `fuse-overlayfs` storage driver and `iptables-legacy` due to the nested container environment (Firecracker VM). The daemon config at `/etc/docker/daemon.json` must specify `{"storage-driver": "fuse-overlayfs"}`.

5. **Environment file**: `cp sample.env .env` provides working defaults for local dev (DB on port 5436, shadow on 5434, dummy AUTH_SECRET).

### Commands reference

Standard commands are documented in `package.json` scripts and `README.md`. Key ones:

- **Lint**: `bun run lint` (ESLint, 0 errors expected, warnings are OK)
- **Type check**: `bun run typecheck` (tsc --noEmit)
- **Unit tests**: `bun run test` (vitest, 670+ tests)
- **Integration tests**: `bun run test:integration` (requires running DB containers)
- **Dev server**: `node ./node_modules/.bin/tsx server.ts` (port 3000)

### Database

- Migrations: `bunx prisma migrate dev`
- Reset: `docker compose down -v && docker compose up -d --wait db db-shadow && bunx prisma migrate dev`
