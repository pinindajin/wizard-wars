# ADR 0010: Structured Logging And Observability Roadmap

Status: Accepted
Date: 2026-04-30

## Context

Wizard Wars needs searchable frontend and backend logs for netcode, rooms, admin actions, and production debugging without flooding Render/Dokploy logs or browser consoles. Backend already uses `pino`; browser code needs its own logger because it cannot import server logging.

## Decision

Use structured, object-first logs with a consistent `event` field. Event names use lowercase dot paths such as `net.connect.success` or `room.player_input.dropped_duplicate`.

Backend logging:

- Keep `pino`.
- Default backend level is `warn`.
- Resolve level from `LOG_LEVEL`, then optionally override from nullable DB config at service startup.
- Admin saves may update current process memory immediately.
- DB override `null` means no override.
- Invalid DB values fall back to env/default and emit a warning.

Frontend logging:

- Use a lightweight typed client logger.
- Default frontend level is `silent`.
- Browser/runtime errors still surface naturally.
- Install `window.wwLog` commands once from a root client installer: `enable`, `disable`, `level`, and `status`.
- Persist client log level in `localStorage`.
- Keep frontend logs local-only in v1, but use pluggable sinks.

Admin control:

- `/dev/admin` is enabled in production behind app-admin auth.
- App admins are users with `User.isAdmin`, exact matches in `ADMIN_USERNAMES`, or usernames matching non-empty `ADMIN_PREFIX`.
- `/dev/admin` exposes log-level override controls, including `NONE` for DB `null`.

Netcode logging:

- Log ownership boundaries, state transitions, rejects, and anomalies.
- Backend owner is `GameLobbyRoom`.
- Frontend owner is `GameConnection`.
- `NetworkSyncSystem` logs anomalies and sampled/summarized sync details only.
- High-frequency tick/input/batch paths must use sampling or aggregate summaries.

## Roadmap

V1:

- Write backend JSON logs to stdout/stderr in production.
- Use platform logs for recent search/debugging.
- Keep frontend logs local console only.
- Avoid high-volume netcode logs in Postgres.

V1.5:

- Add platform log streams to an external sink for retention/search.
- Store only domain/audit events in Postgres, such as admin changes, moderation/security events, and match results.

Future browser log shipping:

- Add `/api/logs/client`.
- Batch, sample, authenticate, rate-limit, and redact.
- Ship warn/error by default; enable debug only with an explicit session flag.

## Consequences

- Logs stay searchable without becoming a telemetry firehose.
- Startup log level remains deterministic and deployment-friendly.
- Frontend debugging is opt-in and reload-stable.
- Multi-instance deployments may not apply admin runtime log-level changes to every instance until a future broadcast/polling mechanism exists.

## Related Code

- `src/server/logger.ts`
- `src/lib/clientLogger.ts`
- `src/app/ClientLoggerInstaller.tsx`
- `src/server/admin/**`
- `src/app/dev/admin/**`
