# Perf Load Tests

Perf-load tests are opt-in local scaling checks for the Colyseus game room.
They do not run in `test`, `test:integration`, `test:e2e`, or `test:all`.

## Commands

Run the default 8-client compact-input gate:

```sh
bun run test:perf-load
```

Run explicit scenarios:

```sh
WW_PERF_LOAD_SCENARIOS=compact8,legacy60-burst bun run test:perf-load
```

Scale duration, clients, and input rate:

```sh
WW_PERF_LOAD_SECONDS=30 WW_PERF_LOAD_CLIENTS=8 WW_PERF_LOAD_INPUT_HZ=60 bun run test:perf-load
```

Run the 8-player, 5-hour compact-input soak target:

```sh
WW_PERF_LOAD_SCENARIOS=compact8 WW_PERF_LOAD_SECONDS=18000 bun run test:perf-load
```

Reports are written to `test-results/perf-load/`. Treat these runs as host-local
signals for ACK gaps, player batch gaps, degraded server status, and input
throughput. Production conclusions still require container CPU/memory limits and
cgroup throttling data from the live host.
