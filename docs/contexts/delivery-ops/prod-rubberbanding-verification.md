# Prod Rubber-Banding Verification

## Purpose

Record production evidence for the Wizard Wars solo rubber-banding/high-CPU investigation. Keep secrets out of this file; use digests, image names, counts, limits, and summarized log lines.

## Current Code-Level Fixes

- Client catch-up prediction sends a fresh full input with a unique sequence number for every committed fixed simulation step.
- React HUD state ignores position-only and ACK-only player batches; Phaser still receives authoritative batches directly.
- The room reports server loop degradation through `server_performance_status` using loop debt, catch-up callbacks, input queue drops, event-loop lag, room tick time, simulation time, visual flush enqueue cost, owner ACK enqueue cost, immediate broadcast enqueue cost, visual-budget deferrals/deferred entities/max deferral age/dropped visuals, critical send failures, process event-loop delay/utilization when supported, CPU, memory, active rooms, and client count. Bun currently treats event-loop utilization as unavailable instead of publishing zeroed readings.
- Server performance classification uses per-window room-loop lag p95 when available, while retaining max room-loop lag as a diagnostic metric. Sub-frame dropped simulation debt is ignored until it reaches the 8 ms diagnostic threshold; raw `droppedDebtMs` remains present in metrics.
- Visual player/fireball/Homing Orb deltas are cadence-limited by `WW_NET_SEND_RATE_HZ` while owner ACKs and critical discrete events remain immediate. The opt-in `WW_NET_SEND_BUDGET_ENABLED` layer can defer visual-only movement/projectile rows under explicit caps; leave it false unless a bounded perf/prod capture is planned.
- Held movement inputs expire after 250ms without accepted input, and empty in-progress rooms clean up after reconnect grace.
- The server coalesces repeated held inputs while advancing ACKs one sequence per tick, matching Seas of Aleryn's transition-preserving queue pressure reduction without skipping client replay history.
- The default fixed-step catch-up budget is `10` ticks so occasional host timer jitter catches up without dropping simulation debt; `WW_SIM_MAX_CATCH_UP_TICKS` remains the rollback knob.
- In-progress rooms emit empty `player_batch_update` heartbeats at the configured visual cadence when no visual deltas are pending, keeping authoritative visual timestamps fresh without exposing owner-only ACK cursors.
- Fireball movement batches now carry `serverTimeMs`, and the client buffers Fireball positions like Homing Orbs instead of snapping sprites on batch receipt.
- `bun run test:perf-load` runs an opt-in local 8-client Colyseus load gate and writes JSON reports under `test-results/perf-load/` with max/p95/p99 ACK and player-batch gaps, degraded reason counts, input-drop totals, heap/RSS deltas, and active-room cleanup evidence.

## Required Production Snapshot

| Check | Value | Notes |
| --- | --- | --- |
| `origin/main` commit | `3cb1b0ef9b9fb41fc08d7401c7819add24f501cf` | Captured with `git ls-remote --heads origin main prod` on 2026-06-01. |
| `origin/prod` commit | `84b18234b0ab06d13860eed0542a74675f12fdbc` | Captured with `git ls-remote --heads origin main prod` on 2026-06-01. |
| Latest `publish-prod-image.yml` run | `26728977234`, success, started `2026-06-01T00:30:34Z` | `gh run list --workflow publish-prod-image.yml --branch prod --limit 5`. |
| GHCR image digest | `ghcr.io/pinindajin/wizard-wars:prod@sha256:5829fc213d3ed28a184b114e41922559a41ed717f9242b07ded1297df3f763c2` | From run `26728977234` build-push logs. |
| Dokploy deploy trigger | Completed in run `26728977234` | The workflow reached the Dokploy deploy step and exited successfully; the curl response body was not visible in logs. |
| Dokploy image digest | TBD | Must match the GHCR prod digest before live conclusions are trusted. Requires Dokploy/API/SSH access. |
| Dokploy replica count | TBD | Keep at `1` until sticky Colyseus routing exists. |
| CPU limit/request | TBD | Record Dokploy/container settings. |
| Memory limit/request | TBD | Record Dokploy/container settings. |
| `cpu.stat` throttling | TBD | Capture `nr_throttled` and `throttled_usec` deltas during solo movement. |
| Active rooms | TBD | Compare room count to expected live games; stale rooms should not accumulate. |
| Connected clients | TBD | Compare app metrics/logs to expected browser sessions. |

## Snapshot Helper

Run this from the repo to capture public Git/HTTP evidence:

```sh
bun run ops:capture-prod-rubberbanding
```

To include Docker image, resource limits, stats, and cgroup throttling from the Dokploy host, provide SSH access and the target container name:

```sh
WW_PROD_SSH_HOST=user@host WW_PROD_CONTAINER=container-name bun run ops:capture-prod-rubberbanding
```

The helper writes a Markdown snapshot to `test-results/prod-rubberbanding/`.
Use `WW_PERF_RUN_ID` to align local perf-load reports, server perf logs, and prod snapshots. Unsafe filename characters are replaced with `_`; when a run id is present, the helper writes `test-results/prod-rubberbanding/<run-id>.md`. Use `WW_PROD_CAPTURE_SECONDS` (`5..18000`, default `60`) and `WW_PROD_SAMPLE_INTERVAL_MS` (`1000..60000`, default `5000`) to collect repeated `docker stats --no-stream` samples and before/after cgroup v2 CPU/memory deltas. The snapshot marks host data incomplete when SSH, target container, stats, cgroup fields, or deltas are unavailable.

For a bounded 10-minute local comparison before production promotion:

```sh
WW_PERF_RUN_ID=local-compact8-10m WW_PERF_LOAD_SCENARIOS=compact8 WW_PERF_LOAD_SECONDS=600 bun run test:perf-load
```

For the 5-hour compact-input soak:

```sh
WW_PERF_RUN_ID=local-compact8-5h WW_PERF_LOAD_SCENARIOS=compact8 WW_PERF_LOAD_SECONDS=18000 bun run test:perf-load
```

For production diagnosis, enable `WW_SERVER_PERF_LOGS=true` only during a bounded capture window, set a matching `WW_PERF_RUN_ID`, restart/redeploy so room processes read the env, and then capture app logs plus this snapshot. The relevant app-log event is `room.performance.window`; summarize bounded log counts and do not paste secrets. Unset the log flag and restart/redeploy after capture.

## Split Realtime Runtime Notes

When web and realtime are deployed separately, record both service roles:

- Web process: `WW_SERVER_MODE=web`, `RUN_MIGRATIONS=true`, `WW_REALTIME_ADMIN_URL`, build-time and runtime `NEXT_PUBLIC_COLYSEUS_URL`, health URL, image/digest, and host/container stats.
- Realtime process: `WW_SERVER_MODE=realtime`, `RUN_MIGRATIONS=false`, `PORT`, `WW_WEB_ORIGIN`, `/healthz`, `/readyz`, image/digest, active-room count, and host/container stats.
- Shared secret presence only: confirm `WW_REALTIME_ADMIN_TOKEN` is set on both services without recording its value.
- Replica policy: keep realtime at one replica until sticky routing and shared Colyseus Presence/Driver design land.

For single-app hosts, the production image defaults to `WW_SERVER_MODE=split`. The container supervisor runs sibling realtime (`PORT=${WW_REALTIME_PORT:-3001}`) and web (`PORT=${PORT:-3000}`) processes, generates a shared internal `WW_REALTIME_ADMIN_TOKEN` when one is not supplied, sets `WW_REALTIME_ADMIN_URL` and `WW_REALTIME_PROXY_URL` to the internal realtime URL, and proxies same-origin `/matchmake/*` plus websocket upgrades from web to realtime. This keeps the browser URL stable while removing the room loop from the Next/API process. Leave `NEXT_PUBLIC_COLYSEUS_URL` unset for this topology; if it is inlined at build time, browser clients connect to that direct URL and bypass the same-origin proxy.

## 2026-06-26 Split Runtime Diagnosis

Prod and local Bun single-process runs reproduced sustained `event_loop_lag` with one no-combat client, including a 1 Hz input probe where the last prod window had only `0.16ms` room-wide broadcast time but still reported `32.3ms` room-loop lag. Local Node/Vitest did not reproduce sustained lag. Local Bun single-process reproduced it (`24/29` degraded statuses), while local Bun split web/realtime with direct realtime connection improved to `5/9` degraded statuses and ended nominal (`eventLoopLagMs ~= 9.3`, `processEventLoopDelayMs ~= 14.3`). Treat this as evidence that true process isolation is a primary production fix path before lower-level simulation tuning.

After adding same-origin split-runtime websocket proxying, room-loop lag p95 classification, an 8 ms dropped-debt diagnostic threshold, and a default 6-tick catch-up budget, local diagnostic run `local-catchup6-proxy-8p-300s-1782506748-compact8` completed 8 clients for 300 seconds. Summary: `sentInputs=20064`, `ownerAcks=20064`, `clientsWithoutOwnerAcks=0`, `maxAckGapMs=183.031`, `ackGapP95Ms=162.117`, `maxPlayerBatchGapMs=524.093`, `playerBatchGapP95Ms=44.048`, `degradedStatusCount=0`, `inputQueueDrops=0`, `roomWideAckCursorLeaks=0`, `wrongOwnerAckCount=0`, `visualBudgetDroppedVisuals=0`, and `criticalSendFailures=0`. The ACK/status/drop evidence was healthy, but `maxPlayerBatchGapMs=524.093` exceeded the normal local perf-load gate of `300ms`, so this run is diagnostic evidence rather than a clean gate pass. Server logs for the same run recorded 320 `room.performance.window` entries, 0 degraded windows, `maxDroppedDebtMs=0`, `maxEventLoopLagMs=62.333`, `maxEventLoopLagP95Ms=13.333`, `maxProcessEventLoopDelayMs=24.988`, and `maxProcessEventLoopDelayP95Ms=10.871`.

After adding empty visual heartbeats, immediate degraded-window perf logging, and a default 10-tick catch-up budget, diagnostic public-path no-combat run `local-heartbeat-catchup10-proxy-8p-300s-1782510427-compact8` met the normal numeric thresholds for 8 clients over 300 seconds. Summary: `sentInputs=20186`, `ownerAcks=20186`, `clientsWithoutOwnerAcks=0`, `maxAckGapMs=184.195`, `ackGapP95Ms=161.23`, `ackGapP99Ms=166.25`, `maxPlayerBatchGapMs=61.494`, `playerBatchGapP95Ms=40.158`, `playerBatchGapP99Ms=47.938`, `degradedStatusCount=0`, `inputQueueDrops=0`, `roomWideAckCursorLeaks=0`, `wrongOwnerAckCount=0`, `visualBudgetDroppedVisuals=0`, and `criticalSendFailures=0`. The report was marked diagnostic-only because it used the production-observation harness rather than the standard local perf-load gate. Server logs for the same run recorded 315 `room.performance.window` entries, 0 degraded windows, `maxDroppedDebtMs=0`, `maxCatchUpCallbacks=9`, `maxEventLoopLagMs=29.333`, `maxEventLoopLagP95Ms=9.333`, `maxProcessEventLoopDelayMs=21.236`, `maxProcessEventLoopDelayP95Ms=10.183`, `maxRoomTickDurationMs=52.756`, `maxBroadcastDurationMs=21.25`, and `maxCpuPercent=24.53`.

After proxy heartbeat and split-supervisor shutdown review fixes, post-review diagnostic public-path no-combat run `local-postreview-heartbeat-catchup10-proxy-8p-300s-1782512544-compact8` again met the normal numeric thresholds for 8 clients over 300 seconds. Summary: `sentInputs=20218`, `ownerAcks=20218`, `clientsWithoutOwnerAcks=0`, `maxAckGapMs=180.899`, `ackGapP95Ms=161.781`, `ackGapP99Ms=166.388`, `maxPlayerBatchGapMs=60.56`, `playerBatchGapP95Ms=40.244`, `playerBatchGapP99Ms=47.258`, `degradedStatusCount=0`, `inputQueueDrops=0`, `roomWideAckCursorLeaks=0`, `wrongOwnerAckCount=0`, `visualBudgetDroppedVisuals=0`, and `criticalSendFailures=0`. Paired server logs recorded 303 `room.performance.window` entries, 0 degraded windows, `maxDroppedDebtMs=0`, `maxCatchUpCallbacks=8`, `maxEventLoopLagMs=31.333`, `maxEventLoopLagP95Ms=10.333`, `maxProcessEventLoopDelayMs=22.473`, `maxProcessEventLoopDelayP95Ms=9.511`, `maxRoomTickDurationMs=55.323`, `maxBroadcastDurationMs=10.391`, and `maxCpuPercent=24.195`. Local split-runtime web/realtime ports `3222`/`3223` were clean after shutdown.

Production image `ghcr.io/pinindajin/wizard-wars@sha256:be1c97c5e4812b0275f5c510c1114ad8375aa2b5cad219150a3626160d1abaa5` from prod commit `9c9c58b` fixed the original no-combat loop degradation in public 8-player testing: run `prod-split-nocombat-8p-5m-1782514545` completed 300 seconds at 60 Hz with `sentInputs=23748`, `ownerAcks=23748`, `maxAckGapMs=168.834`, `maxPlayerBatchGapMs=83.606`, `degradedStatusCount=0`, `inputQueueDrops=0`, `criticalSendFailures=0`, and `visualBudgetDroppedVisuals=0`. A combat-enabled follow-up run on the same image did not show loop degradation (`degradedStatusCount=0`, `maxAckGapMs=156.075`, `maxPlayerBatchGapMs=104.582`) but ended early when all clients entered Colyseus reconnection after match lifecycle closed the combat room. The follow-up fix is match-end semantics: the first zero-life spectator in a larger multiplayer match must not trigger `lives_depleted`; the match should continue until eliminations leave one or zero active players.

Production image `ghcr.io/pinindajin/wizard-wars@sha256:85d993f2f4235019d72a9e6b2d6e3fb9b8815f4eb1a57e93182178ab77ecc317` from prod commit `6e4a881` includes the match-end semantics fix and passed the target combat verification after deploy settle. A first post-deploy combat run, `prod-matchend-combat-8p-5m-1782520154`, completed 300 seconds with no reconnect/lifecycle failure and healthy ACK/batch gaps, but observed one transient `event_loop_lag` degraded status. The warmed follow-up run `prod-warm-combat-8p-5m-1782520532` completed 300 seconds at 60 Hz with combat enabled and 8 clients: `sentInputs=25071`, `ownerAcks=25071`, `playerBatches=72248`, `clientsWithoutOwnerAcks=0`, `maxAckGapMs=171.996`, `ackGapP95Ms=129.057`, `ackGapP99Ms=135.384`, `maxPlayerBatchGapMs=83.912`, `playerBatchGapP95Ms=47.293`, `playerBatchGapP99Ms=51.832`, `degradedStatusCount=0`, `inputQueueDrops=0`, `criticalSendFailures=0`, `visualBudgetDroppedVisuals=0`, `roomWideAckCursorLeaks=0`, and `wrongOwnerAckCount=0`. The last status stayed nominal because classification uses sustained room-loop lag p95 (`eventLoopLagP95Ms=7.333`) even though the diagnostic max lag field reported a transient `eventLoopLagMs=46.333`.

Normal local perf-load gates require ACK max gap `<=250ms`, player batch max gap `<=300ms`, degraded status count `<=1`, input drops `0`, `criticalSendFailures=0`, and `visualBudgetDroppedVisuals=0`. `server_performance_status.metrics.broadcastDurationMs` excludes the separately reported `ownerAckSendDurationMs` and `immediateBroadcastDurationMs`, so `broadcast_slow` reflects room-wide batch pressure rather than double-counted critical sends. The active-room cleanup count is report-only because in-progress rooms intentionally remain eligible for reconnect during `RECONNECT_WINDOW_MS`; the compatibility `activeRoomLeakDetected` flag remains false for this immediate sample, and suspected room leaks need a delayed check after reconnect grace. `WW_PERF_LOAD_DIAGNOSTIC_ONLY=true` with `WW_PERF_LOAD_DIAGNOSTIC_REASON` is reserved for non-gating investigations and must be called out as diagnostic-only in PR evidence.

For a bounded visual send-budget comparison, keep the feature disabled for the baseline run, then rerun with explicit caps:

```sh
WW_PERF_RUN_ID=local-budget-compact8 WW_NET_SEND_BUDGET_ENABLED=true WW_NET_SEND_BUDGET_MAX_PLAYER_DELTAS=16 WW_NET_SEND_BUDGET_MAX_PROJECTILE_DELTAS=64 WW_NET_SEND_BUDGET_MAX_REMOVALS=64 WW_NET_SEND_BUDGET_MAX_DEFERRAL_MS=250 WW_PERF_LOAD_SCENARIOS=compact8 WW_PERF_LOAD_SECONDS=600 bun run test:perf-load
```

The budget-on report should show bounded `visualBudgetMaxDeferralAgeMs`, zero `criticalSendFailures`, zero `visualBudgetDroppedVisuals`, no room-wide ACK cursor leaks, and ACK/player-batch gaps within the normal gate thresholds. Production enablement should use the same run id family in server logs and `ops:capture-prod-rubberbanding`, then compare cgroup throttling and `server_performance_status` counters before drawing conclusions.

## 2026-06-23 Live Solo Evidence

Public browser playtest against `https://wizard-wars.pinindajin.online` entered a solo match and observed `29/29` degraded `server_performance_status` payloads over roughly 30 seconds. The degradation reason was `event_loop_lag`; the last payload reported about `46ms` event-loop lag, about `11ms` broadcast time, `8` catch-up callbacks, `1` active room, and `1` connected client. This strongly suggests the deployed host/image still needs the required Dokploy/container snapshot before attributing live symptoms to current `main`.

## Log Evidence To Capture

- `room.player_input.queue_cap_drop` warning counts during solo movement.
- `server_performance_status` payloads where `degraded=true`, especially `reasons`.
- Loop debt/catch-up summaries from app logs, especially `room.performance.window` when `WW_SERVER_PERF_LOGS=true`.
- Visual-budget counters from `server_performance_status` and perf-load reports: `visualBudgetDeferrals`, `visualBudgetDeferredEntities`, `visualBudgetMaxDeferralAgeMs`, `visualBudgetDroppedVisuals`, and `criticalSendFailures`.
- Docker CPU and memory samples while moving and while idle.
- Cgroup v2 `cpu.stat`, `cpu.max`, `memory.current`, `memory.max`, and `memory.events` before/after deltas.

## Interpretation

- If Dokploy image digest does not match the latest GHCR prod digest, update/redeploy before attributing symptoms to current code.
- If `server_performance_status.reasons` includes `event_loop_lag`, `broadcast_slow`, or `dropped_debt` while Docker CPU throttling climbs, treat platform CPU quota as a primary suspect.
- If `input_queue_drops` appears during solo movement after the sequence-number fix, inspect client send rate and server processing pressure.
- If active room count grows after all clients leave, investigate reconnect grace cleanup and room disposal.

## Rollback Levers

- Set `WW_SERVER_MODE=single` to bypass the single-container split supervisor and return to the pre-split web/Colyseus cohosted runtime.
- Unset `WW_REALTIME_PROXY_URL` in `WW_SERVER_MODE=web` deployments to disable same-origin Colyseus proxying; browser clients then need a valid direct `NEXT_PUBLIC_COLYSEUS_URL`.
- For two-service deployments, keep using explicit `WW_SERVER_MODE=web` and `WW_SERVER_MODE=realtime` instead of `WW_SERVER_MODE=split`.
- Set `WW_SIM_MAX_CATCH_UP_TICKS=4` to restore the previous fixed-step catch-up cap.
- Set `WW_SIM_MAX_CATCH_UP_TICKS=6` to restore the intermediate cap used during the split-runtime diagnosis.
- Set `WW_NET_SEND_RATE_HZ=60` to restore previous visual batch cadence.
- Set `WW_NET_SEND_BUDGET_ENABLED=false` or unset it, then restart/redeploy realtime room processes to disable visual send budgeting.
- Set `WW_SERVER_PERF_LOGS=false` and restart/redeploy to disable opt-in server performance logs.
- Revert the production event-loop instrumentation PR if the always-initialized room monitor itself becomes suspect.
- Hide the player-facing overlay hook if the indicators themselves cause unexpected UI issues.
- Revert the rubber-banding/performance-indicator PR if telemetry shows a new regression.
