# Prod Rubber-Banding Verification

## Purpose

Record production evidence for the Wizard Wars solo rubber-banding/high-CPU investigation. Keep secrets out of this file; use digests, image names, counts, limits, and summarized log lines.

## Current Code-Level Fixes

- Client catch-up prediction sends a fresh full input with a unique sequence number for every committed fixed simulation step.
- React HUD state ignores position-only and ACK-only player batches; Phaser still receives authoritative batches directly.
- The room reports server loop degradation through `server_performance_status` using loop debt, catch-up callbacks, input queue drops, event-loop lag, broadcast cost, CPU, memory, active rooms, and client count.
- Visual player/fireball deltas are cadence-limited by `WW_NET_SEND_RATE_HZ` while owner ACKs and critical discrete events remain immediate.
- Held movement inputs expire after 250ms without accepted input, and empty in-progress rooms clean up after reconnect grace.

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

## Log Evidence To Capture

- `room.player_input.queue_cap_drop` warning counts during solo movement.
- `server_performance_status` payloads where `degraded=true`, especially `reasons`.
- Loop debt/catch-up summaries from app logs.
- Docker CPU and memory samples while moving and while idle.

## Interpretation

- If Dokploy image digest does not match the latest GHCR prod digest, update/redeploy before attributing symptoms to current code.
- If `server_performance_status.reasons` includes `event_loop_lag`, `broadcast_slow`, or `dropped_debt` while Docker CPU throttling climbs, treat platform CPU quota as a primary suspect.
- If `input_queue_drops` appears during solo movement after the sequence-number fix, inspect client send rate and server processing pressure.
- If active room count grows after all clients leave, investigate reconnect grace cleanup and room disposal.

## Rollback Levers

- Set `WW_NET_SEND_RATE_HZ=60` to restore previous visual batch cadence.
- Hide the player-facing overlay hook if the indicators themselves cause unexpected UI issues.
- Revert the rubber-banding/performance-indicator PR if telemetry shows a new regression.
