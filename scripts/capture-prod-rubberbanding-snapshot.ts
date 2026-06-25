import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  DEFAULT_PROD_CAPTURE_SECONDS,
  DEFAULT_PROD_SAMPLE_INTERVAL_MS,
  MAX_PROD_CAPTURE_SECONDS,
  MAX_PROD_SAMPLE_INTERVAL_MS,
  MIN_PROD_CAPTURE_SECONDS,
  MIN_PROD_SAMPLE_INTERVAL_MS,
  sanitizePerfRunId,
} from "../src/server/game/performanceConfig"

export type CommandResult = {
  readonly label: string
  readonly command: string
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

export type ProdRubberbandingSnapshotConfig = {
  readonly prodUrl: string
  readonly outPath: string
  readonly perfRunId: string | null
  readonly captureSeconds: number
  readonly sampleIntervalMs: number
  readonly sshHost: string | undefined
  readonly prodContainer: string | undefined
  readonly cwd: string
  readonly capturedAtIso: string
}

export type ProdRubberbandingSnapshot = {
  readonly outPath: string
  readonly markdown: string
}

const DEFAULT_PROD_URL = "https://wizard-wars.pinindajin.online"

/**
 * Resolves snapshot options from env-like input.
 *
 * @param input - Current cwd/env/time.
 * @returns Snapshot config.
 */
export function resolveProdRubberbandingSnapshotConfig(input: {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly now: Date
}): ProdRubberbandingSnapshotConfig {
  const perfRunId = sanitizePerfRunId(input.env.WW_PERF_RUN_ID)
  const capturedAtIso = input.now.toISOString()
  const filenameBase = capturedAtIso.replaceAll(":", "-")
  const filename = perfRunId ? `${filenameBase}-${perfRunId}.md` : `${filenameBase}.md`
  return {
    prodUrl: input.env.WW_PROD_URL ?? DEFAULT_PROD_URL,
    outPath:
      input.env.WW_PROD_SNAPSHOT_OUT ??
      join(input.cwd, "test-results", "prod-rubberbanding", filename),
    perfRunId,
    captureSeconds: parseBoundedInt(
      input.env.WW_PROD_CAPTURE_SECONDS,
      DEFAULT_PROD_CAPTURE_SECONDS,
      MIN_PROD_CAPTURE_SECONDS,
      MAX_PROD_CAPTURE_SECONDS,
    ),
    sampleIntervalMs: parseBoundedInt(
      input.env.WW_PROD_SAMPLE_INTERVAL_MS,
      DEFAULT_PROD_SAMPLE_INTERVAL_MS,
      MIN_PROD_SAMPLE_INTERVAL_MS,
      MAX_PROD_SAMPLE_INTERVAL_MS,
    ),
    sshHost: input.env.WW_PROD_SSH_HOST,
    prodContainer: input.env.WW_PROD_CONTAINER,
    cwd: input.cwd,
    capturedAtIso,
  }
}

/**
 * Builds snapshot Markdown by running public and optional SSH checks.
 *
 * @param input - Snapshot config and command runner.
 * @returns Output path and Markdown body.
 */
export function buildProdRubberbandingSnapshot(input: {
  readonly config: ProdRubberbandingSnapshotConfig
  readonly run: (command: string, args: readonly string[]) => CommandResult
}): ProdRubberbandingSnapshot {
  const { config } = input
  const sections: string[] = []

  sections.push("# Production Rubber-Banding Snapshot")
  sections.push("")
  sections.push(`Captured at: ${config.capturedAtIso}`)
  sections.push(`Production URL: ${config.prodUrl}`)
  sections.push(`Run id: \`${config.perfRunId ?? "none"}\``)
  sections.push(`Capture seconds: \`${config.captureSeconds}\``)
  sections.push(`Sample interval ms: \`${config.sampleIntervalMs}\``)
  sections.push("")

  appendResult(sections, "current commit", input.run("git", ["rev-parse", "HEAD"]))
  appendResult(
    sections,
    "origin main/prod refs",
    input.run("git", ["ls-remote", "--heads", "origin", "main", "prod"]),
  )
  appendResult(
    sections,
    "production response headers",
    input.run("curl", [
      "-fsSI",
      "--connect-timeout",
      "10",
      "--max-time",
      "20",
      config.prodUrl,
    ]),
  )

  if (config.sshHost) {
    appendResult(
      sections,
      "remote docker containers",
      runSsh(
        config,
        input.run,
        "docker ps --format 'table {{.ID}}\\t{{.Image}}\\t{{.Names}}\\t{{.Status}}'",
      ),
    )
    appendResult(
      sections,
      "remote docker stats",
      runSsh(config, input.run, "docker stats --no-stream"),
    )

    if (config.prodContainer) {
      const container = shellQuote(config.prodContainer)
      appendResult(
        sections,
        "target container image and resource limits",
        runSsh(
          config,
          input.run,
          [
            `docker inspect ${container}`,
            "--format",
            shellQuote(
              [
                "id={{.Id}}",
                "image={{.Config.Image}}",
                "nano_cpus={{.HostConfig.NanoCpus}}",
                "cpu_quota={{.HostConfig.CpuQuota}}",
                "cpu_period={{.HostConfig.CpuPeriod}}",
                "memory={{.HostConfig.Memory}}",
                "memory_swap={{.HostConfig.MemorySwap}}",
                "restart={{.HostConfig.RestartPolicy.Name}}",
              ].join("\\n"),
            ),
          ].join(" "),
        ),
      )
      appendResult(
        sections,
        "target container cgroup cpu/memory",
        runSsh(
          config,
          input.run,
          [
            `docker exec ${container} sh -lc`,
            shellQuote(
              [
                "printf 'cpu.stat\\n'",
                "cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true",
                "printf '\\nmemory.current\\n'",
                "cat /sys/fs/cgroup/memory.current 2>/dev/null || true",
                "printf '\\nmemory.max\\n'",
                "cat /sys/fs/cgroup/memory.max 2>/dev/null || true",
              ].join("; "),
            ),
          ].join(" "),
        ),
      )
    } else {
      sections.push("## Target Container")
      sections.push("")
      sections.push(
        "`WW_PROD_CONTAINER` was not set, so image digest, resource limits, and cgroup throttling were not captured for a specific container.",
      )
      sections.push("")
    }
  } else {
    sections.push("## Remote Host")
    sections.push("")
    sections.push(
      "`WW_PROD_SSH_HOST` was not set, so Dokploy/container CPU, memory, replica, and cgroup throttling data were not captured.",
    )
    sections.push("")
  }

  return {
    outPath: config.outPath,
    markdown: `${sections.join("\n")}\n`,
  }
}

/**
 * Appends one redacted command result section to the snapshot document.
 *
 * @param sections - Mutable Markdown section list.
 * @param label - Section title.
 * @param result - Captured command result.
 */
function appendResult(
  sections: string[],
  label: string,
  result: CommandResult,
): void {
  sections.push(`## ${label}`)
  sections.push("")
  sections.push(`Command: \`${redactSensitiveText(result.command)}\``)
  sections.push(`Exit: ${result.ok ? "0" : "non-zero"}`)
  sections.push("")
  if (result.stdout.trim() !== "") {
    sections.push("```text")
    sections.push(redactSensitiveText(result.stdout.trimEnd()))
    sections.push("```")
    sections.push("")
  }
  if (result.stderr.trim() !== "") {
    sections.push("stderr:")
    sections.push("```text")
    sections.push(redactSensitiveText(result.stderr.trimEnd()))
    sections.push("```")
    sections.push("")
  }
}

/**
 * Runs one local snapshot command and captures output without throwing.
 *
 * @param command - Executable name or path.
 * @param args - Command arguments.
 * @param cwd - Working directory.
 * @returns Captured command result.
 */
export function runSnapshotCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  })
  return {
    label: command,
    command: [command, ...args.map(shellQuote)].join(" "),
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  }
}

/**
 * Runs one remote command through SSH using the configured production host.
 *
 * @param config - Snapshot config containing the SSH host.
 * @param runner - Command runner to invoke.
 * @param remoteCommand - Shell command to execute remotely.
 * @returns Captured SSH command result.
 */
function runSsh(
  config: ProdRubberbandingSnapshotConfig,
  runner: (command: string, args: readonly string[]) => CommandResult,
  remoteCommand: string,
): CommandResult {
  /* v8 ignore next -- buildProdRubberbandingSnapshot calls runSsh only after this guard is satisfied. */
  if (!config.sshHost) throw new Error("WW_PROD_SSH_HOST is required")
  return runner("ssh", [config.sshHost, remoteCommand])
}

/**
 * Quotes one shell argument when needed for command display/execution.
 *
 * @param value - Raw shell argument.
 * @returns Safely quoted shell argument.
 */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Parses and clamps one integer env value.
 *
 * @param raw - Raw env string.
 * @param fallback - Value to use when raw is unset or invalid.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @returns Parsed bounded integer.
 */
function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/**
 * Redacts secrets from captured commands and output before writing artifacts.
 *
 * @param text - Raw command text or command output.
 * @returns Text with known secret shapes redacted.
 */
function redactSensitiveText(text: string): string {
  return text
    .replaceAll(
      /(authorization:\s*bearer\s+)[^\s'"]+/gi,
      "$1[REDACTED]",
    )
    .replaceAll(/(x-api-key:\s*)[^\s'"]+/gi, "$1[REDACTED]")
    .replaceAll(/((?:token|secret|password)=)[^\s'"]+/gi, "$1[REDACTED]")
}

/* v8 ignore start -- CLI file IO is covered through pure snapshot helper tests. */
/**
 * Runs the production snapshot CLI and writes the Markdown artifact.
 */
function main(): void {
  const config = resolveProdRubberbandingSnapshotConfig({
    cwd: process.cwd(),
    env: process.env,
    now: new Date(),
  })
  const snapshot = buildProdRubberbandingSnapshot({
    config,
    run: (command, args) => runSnapshotCommand(command, args, config.cwd),
  })
  mkdirSync(dirname(snapshot.outPath), { recursive: true })
  writeFileSync(snapshot.outPath, snapshot.markdown, "utf8")
  console.log(snapshot.outPath)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
/* v8 ignore stop */
