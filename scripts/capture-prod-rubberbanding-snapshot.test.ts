import { describe, expect, it } from "vitest"

import {
  buildProdRubberbandingSnapshot,
  resolveProdRubberbandingSnapshotConfig,
  runSnapshotCommand,
} from "./capture-prod-rubberbanding-snapshot"

describe("production rubber-banding snapshot helper", () => {
  it("sanitizes run ids and clamps capture sampling env", () => {
    const config = resolveProdRubberbandingSnapshotConfig({
      cwd: "/repo",
      env: {
        WW_PERF_RUN_ID: " local:compact/8 ",
        WW_PROD_CAPTURE_SECONDS: "1",
        WW_PROD_SAMPLE_INTERVAL_MS: "999999",
      },
      now: new Date("2026-06-25T01:02:03.000Z"),
    })

    expect(config).toMatchObject({
      perfRunId: "local_compact_8",
      captureSeconds: 5,
      sampleIntervalMs: 60_000,
      outPath: "/repo/test-results/prod-rubberbanding/local_compact_8.md",
    })

    expect(
      resolveProdRubberbandingSnapshotConfig({
        cwd: "/repo",
        env: {
          WW_PROD_SNAPSHOT_OUT: "/tmp/custom.md",
          WW_PERF_RUN_ID: "!!!",
          WW_PROD_CAPTURE_SECONDS: "wat",
          WW_PROD_SAMPLE_INTERVAL_MS: "",
        },
        now: new Date("2026-06-25T01:02:03.000Z"),
      }),
    ).toMatchObject({
      perfRunId: null,
      captureSeconds: 60,
      sampleIntervalMs: 5_000,
      outPath: "/tmp/custom.md",
    })
  })

  it("builds markdown with run metadata, missing-data notes, and redacted command output", () => {
    const snapshot = buildProdRubberbandingSnapshot({
      config: {
        prodUrl: "https://example.test",
        outPath: "/repo/test-results/prod-rubberbanding/snapshot.md",
        perfRunId: "local_compact_8",
        captureSeconds: 60,
        sampleIntervalMs: 5_000,
        sshHost: undefined,
        prodContainer: undefined,
        cwd: "/repo",
        capturedAtIso: "2026-06-25T01:02:03.000Z",
      },
      run: (command, args) => ({
        label: command,
        command: [command, ...args].join(" "),
        ok: true,
        stdout: "Authorization: Bearer secret-token\nx-api-key: also-secret",
        stderr: "",
      }),
    })

    expect(snapshot.markdown).toContain("Run id: `local_compact_8`")
    expect(snapshot.markdown).toContain("Capture seconds: `60`")
    expect(snapshot.markdown).toContain("`WW_PROD_SSH_HOST` was not set")
    expect(snapshot.markdown).toContain("Authorization: Bearer [REDACTED]")
    expect(snapshot.markdown).toContain("x-api-key: [REDACTED]")
    expect(snapshot.markdown).not.toContain("secret-token")
    expect(snapshot.outPath).toBe("/repo/test-results/prod-rubberbanding/snapshot.md")
  })

  it("redacts cookies, URLs, env secrets, and key/token-like output", () => {
    const snapshot = buildProdRubberbandingSnapshot({
      config: {
        prodUrl: "https://example.test",
        outPath: "/repo/test-results/prod-rubberbanding/snapshot.md",
        perfRunId: "prod",
        captureSeconds: 60,
        sampleIntervalMs: 5_000,
        sshHost: undefined,
        prodContainer: undefined,
        cwd: "/repo",
        capturedAtIso: "2026-06-25T01:02:03.000Z",
      },
      run: (command, args) => ({
        label: command,
        command: [command, ...args].join(" "),
        ok: true,
        stdout: [
          "Cookie: session=secret-cookie",
          "AUTH_SECRET=secret-auth",
          "DATABASE_URL=postgresql://user:pass@host/db",
          "private_key=secret-key",
          "serviceToken: secret-service-token",
        ].join("\n"),
        stderr: "",
      }),
    })

    expect(snapshot.markdown).toContain("Cookie: [REDACTED]")
    expect(snapshot.markdown).toContain("AUTH_SECRET=[REDACTED]")
    expect(snapshot.markdown).toContain("DATABASE_URL=[REDACTED]")
    expect(snapshot.markdown).toContain("private_key=[REDACTED]")
    expect(snapshot.markdown).toContain("serviceToken: [REDACTED]")
    expect(snapshot.markdown).not.toContain("secret-cookie")
    expect(snapshot.markdown).not.toContain("secret-auth")
    expect(snapshot.markdown).not.toContain("postgresql://user:pass@host/db")
    expect(snapshot.markdown).not.toContain("secret-key")
    expect(snapshot.markdown).not.toContain("secret-service-token")
  })

  it("captures optional SSH host data and reports when a target container is missing", () => {
    const commands: string[] = []
    const snapshot = buildProdRubberbandingSnapshot({
      config: {
        prodUrl: "https://example.test",
        outPath: "/repo/test-results/prod-rubberbanding/snapshot.md",
        perfRunId: null,
        captureSeconds: 60,
        sampleIntervalMs: 5_000,
        sshHost: "deploy@example.test",
        prodContainer: undefined,
        cwd: "/repo",
        capturedAtIso: "2026-06-25T01:02:03.000Z",
      },
      run: (command, args) => {
        commands.push([command, ...args].join(" "))
        return {
          label: command,
          command: [command, ...args].join(" "),
          ok: true,
          stdout: "",
          stderr: "token=secret-token",
        }
      },
    })

    expect(commands).toContain(
      "ssh deploy@example.test docker ps --format 'table {{.ID}}\\t{{.Image}}\\t{{.Names}}\\t{{.Status}}'",
    )
    expect(commands).toContain("ssh deploy@example.test docker stats --no-stream")
    expect(snapshot.markdown).toContain("`WW_PROD_CONTAINER` was not set")
    expect(snapshot.markdown).toContain("token=[REDACTED]")
    expect(snapshot.markdown).not.toContain("secret-token")
  })

  it("captures target container image and cgroup commands with shell quoting", () => {
    const commands: string[] = []
    const snapshot = buildProdRubberbandingSnapshot({
      config: {
        prodUrl: "https://example.test",
        outPath: "/repo/test-results/prod-rubberbanding/snapshot.md",
        perfRunId: "prod",
        captureSeconds: 60,
        sampleIntervalMs: 5_000,
        sshHost: "deploy@example.test",
        prodContainer: "wizard wars'app",
        cwd: "/repo",
        capturedAtIso: "2026-06-25T01:02:03.000Z",
      },
      run: (command, args) => {
        commands.push([command, ...args].join(" "))
        return {
          label: command,
          command: [command, ...args].join(" "),
          ok: true,
          stdout: "ok",
          stderr: "",
        }
      },
    })

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("docker inspect 'wizard wars'\\''app' --format"),
        expect.stringContaining("docker exec 'wizard wars'\\''app' sh -lc"),
      ]),
    )
    expect(snapshot.markdown).toContain("target container image and resource limits")
    expect(snapshot.markdown).toContain("target container cgroup cpu/memory")
  })

  it("captures repeated host samples, cgroup fields, and before/after deltas", () => {
    let cpuStatCall = 0
    const waits: number[] = []
    const snapshot = buildProdRubberbandingSnapshot({
      config: {
        prodUrl: "https://example.test",
        outPath: "/repo/test-results/prod-rubberbanding/snapshot.md",
        perfRunId: "prod",
        captureSeconds: 10,
        sampleIntervalMs: 5_000,
        sshHost: "deploy@example.test",
        prodContainer: "wizard-wars",
        cwd: "/repo",
        capturedAtIso: "2026-06-25T01:02:03.000Z",
      },
      run: (command, args) => {
        const commandText = [command, ...args].join(" ")
        if (commandText.includes("docker stats")) {
          return {
            label: command,
            command: commandText,
            ok: true,
            stdout: "name,cpu,mem\nwizard-wars,50%,256MiB",
            stderr: "",
          }
        }
        if (commandText.includes("cat /sys/fs/cgroup/cpu.stat")) {
          cpuStatCall += 1
          return {
            label: command,
            command: commandText,
            ok: true,
            stdout: [
              `cpu.stat\nnr_periods ${100 + cpuStatCall}`,
              `nr_throttled ${5 + cpuStatCall}`,
              `throttled_usec ${1000 + cpuStatCall * 100}`,
              "\ncpu.max\n100000 100000",
              "\nmemory.current\n1024",
              "\nmemory.max\n2048",
              "\nmemory.events\nlow 0\nhigh 1\nmax 0\noom 0\noom_kill 0",
            ].join("\n"),
            stderr: "",
          }
        }
        return {
          label: command,
          command: commandText,
          ok: true,
          stdout: "",
          stderr: "",
        }
      },
      waitBetweenSamplesMs: (ms) => {
        waits.push(ms)
      },
    })

    expect(snapshot.markdown).toContain("Host data complete: `true`")
    expect(snapshot.markdown).toContain("Docker stats samples: `3`")
    expect(snapshot.markdown).toContain("cpu.max")
    expect(snapshot.markdown).toContain("memory.events")
    expect(snapshot.markdown).toContain("nr_throttled delta: `1`")
    expect(snapshot.markdown).toContain("throttled_usec delta: `100`")
    expect(waits).toEqual([5_000, 5_000])
  })

  it("marks host data incomplete when cgroup fields are malformed or missing", () => {
    const snapshot = buildProdRubberbandingSnapshot({
      config: {
        prodUrl: "https://example.test",
        outPath: "/repo/test-results/prod-rubberbanding/snapshot.md",
        perfRunId: "prod",
        captureSeconds: 5,
        sampleIntervalMs: 5_000,
        sshHost: "deploy@example.test",
        prodContainer: "wizard-wars",
        cwd: "/repo",
        capturedAtIso: "2026-06-25T01:02:03.000Z",
      },
      run: (command, args) => {
        const commandText = [command, ...args].join(" ")
        if (commandText.includes("docker stats")) {
          return {
            label: command,
            command: commandText,
            ok: true,
            stdout: "name,cpu,mem\nwizard-wars,50%,256MiB",
            stderr: "",
          }
        }
        if (commandText.includes("cat /sys/fs/cgroup/cpu.stat")) {
          return {
            label: command,
            command: commandText,
            ok: true,
            stdout: [
              "cpu.stat",
              "nr_throttled nope",
              "badline",
              "\ncpu.max\n100000 100000",
              "\nmemory.current\nmax",
              "\nmemory.max\nmax",
              "\nmemory.events",
            ].join("\n"),
            stderr: "",
          }
        }
        return {
          label: command,
          command: commandText,
          ok: true,
          stdout: "",
          stderr: "",
        }
      },
    })

    expect(snapshot.markdown).toContain("Host data complete: `false`")
    expect(snapshot.markdown).toContain("memory.current before: `missing`")
  })

  it("runs local snapshot commands and captures quoted command text", () => {
    const result = runSnapshotCommand(
      process.execPath,
      ["-e", "process.stdout.write('ok')"],
      process.cwd(),
    )

    expect(result.ok).toBe(true)
    expect(result.stdout).toBe("ok")
    expect(result.command).toContain("process.stdout.write")
  })
})
