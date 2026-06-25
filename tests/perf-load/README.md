# Perf Load Tests

Perf-load tests are opt-in local scaling checks for the Colyseus game room.
They do not run in `test`, `test:integration`, `test:e2e`, or `test:all`.

## Commands

Run the default 8-client compact-input gate:

```sh
bun run test:perf-load
```

Tag reports with a shared run id. Unsafe filename characters are replaced with
`_`, and the artifact path becomes
`test-results/perf-load/<run-id>-<scenario>.json`:

```sh
WW_PERF_RUN_ID=local-compact8 bun run test:perf-load
```

Run explicit scenarios:

```sh
WW_PERF_LOAD_SCENARIOS=compact8,legacy60-burst bun run test:perf-load
```

Scale duration, clients, and input rate:

```sh
WW_PERF_LOAD_SECONDS=30 WW_PERF_LOAD_CLIENTS=8 WW_PERF_LOAD_INPUT_HZ=60 bun run test:perf-load
```

Run the 8-player, 10-minute compact-input gate used before production
promotion:

```sh
WW_PERF_RUN_ID=local-compact8-10m WW_PERF_LOAD_SCENARIOS=compact8 WW_PERF_LOAD_SECONDS=600 bun run test:perf-load
```

Run the 8-player, 5-hour compact-input soak target:

```sh
WW_PERF_RUN_ID=local-compact8-5h WW_PERF_LOAD_SCENARIOS=compact8 WW_PERF_LOAD_SECONDS=18000 bun run test:perf-load
```

Reports are written to `test-results/perf-load/`. Treat these runs as host-local
signals for ACK max/p95/p99 gaps, player batch max/p95/p99 gaps, degraded server
status counts/reasons, input-drop totals, heap/RSS deltas, active-room cleanup,
and input throughput. Normal gates allow at most one degraded status and zero
input drops.

`activeRoomsAfterCleanup` is captured after clients leave but before the
60-second in-progress reconnect grace necessarily expires. Treat nonzero values
as a follow-up signal, not as a hard pass/fail gate.

Use `WW_PERF_LOAD_TEST_TIMEOUT_MS` only when a slow host needs a larger Vitest
timeout than `WW_PERF_LOAD_SECONDS + 180s`. Use
`WW_PERF_LOAD_DIAGNOSTIC_ONLY=true` with `WW_PERF_LOAD_DIAGNOSTIC_REASON` only
for non-gating investigations; diagnostic-only reports may allow more degraded
status windows and must not be presented as passing rollout evidence.

Production conclusions still require deployed commit/image evidence, container
CPU/memory limits, repeated Docker stats, and cgroup throttling deltas from the
live host.
