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

type CgroupSnapshot = {
  readonly cpuStat: Readonly<Record<string, number>>
  readonly cpuMax: string | null
  readonly memoryCurrent: number | null
  readonly memoryMax: string | null
  readonly memoryEvents: Readonly<Record<string, number>>
  readonly complete: boolean
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
  const filename = perfRunId ? `${perfRunId}.md` : `${filenameBase}.md`
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
  readonly waitBetweenSamplesMs?: ((ms: number) => void) | undefined
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
    let dockerStatsSampleCount = 0
    let dockerStatsComplete = true
    let cgroupBefore: CgroupSnapshot | null = null
    let cgroupAfter: CgroupSnapshot | null = null
    let cgroupBeforeResult: CommandResult | null = null
    let cgroupAfterResult: CommandResult | null = null
    appendResult(
      sections,
      "remote docker containers",
      runSsh(
        config,
        input.run,
        "docker ps --format 'table {{.ID}}\\t{{.Image}}\\t{{.Names}}\\t{{.Status}}'",
      ),
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
      cgroupBeforeResult = runSsh(
        config,
        input.run,
        buildCgroupCommand(container),
      )
      cgroupBefore = parseCgroupSnapshot(cgroupBeforeResult.stdout)
      appendResult(
        sections,
        "target container cgroup cpu/memory before",
        cgroupBeforeResult,
      )
      const stats = captureDockerStatsSamples(config, input.run, input.waitBetweenSamplesMs)
      dockerStatsSampleCount = stats.sampleCount
      dockerStatsComplete = stats.complete
      for (const [index, result] of stats.results.entries()) {
        appendResult(sections, `remote docker stats sample ${index + 1}`, result)
      }
      cgroupAfterResult = runSsh(config, input.run, buildCgroupCommand(container))
      cgroupAfter = parseCgroupSnapshot(cgroupAfterResult.stdout)
      appendResult(
        sections,
        "target container cgroup cpu/memory after",
        cgroupAfterResult,
      )
      appendHostEvidenceSummary(sections, {
        dockerStatsSampleCount,
        dockerStatsComplete,
        cgroupBefore,
        cgroupAfter,
        cgroupBeforeOk: cgroupBeforeResult.ok,
        cgroupAfterOk: cgroupAfterResult.ok,
      })
    } else {
      const stats = captureDockerStatsSamples(config, input.run, input.waitBetweenSamplesMs)
      dockerStatsSampleCount = stats.sampleCount
      dockerStatsComplete = stats.complete
      for (const [index, result] of stats.results.entries()) {
        appendResult(sections, `remote docker stats sample ${index + 1}`, result)
      }
      appendHostEvidenceSummary(sections, {
        dockerStatsSampleCount,
        dockerStatsComplete,
        cgroupBefore,
        cgroupAfter,
        cgroupBeforeOk: false,
        cgroupAfterOk: false,
      })
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
 * Captures repeated Docker stats samples, optionally waiting between each one.
 *
 * @param config - Resolved snapshot config.
 * @param runner - Command runner to invoke.
 * @param waitBetweenSamplesMs - Optional sync wait used by the CLI.
 * @returns Captured Docker stats results and completeness state.
 */
function captureDockerStatsSamples(
  config: ProdRubberbandingSnapshotConfig,
  runner: (command: string, args: readonly string[]) => CommandResult,
  waitBetweenSamplesMs?: ((ms: number) => void) | undefined,
): {
  readonly results: readonly CommandResult[]
  readonly sampleCount: number
  readonly complete: boolean
} {
  const results: CommandResult[] = []
  const sampleCount = resolveDockerStatsSampleCount(config)
  let complete = true
  for (let index = 0; index < sampleCount; index += 1) {
    if (index > 0) waitBetweenSamplesMs?.(config.sampleIntervalMs)
    const result = runSsh(config, runner, "docker stats --no-stream")
    results.push(result)
    complete &&= result.ok
  }
  return { results, sampleCount: results.length, complete }
}

/**
 * Calculates how many host samples to capture for the configured window.
 *
 * @param config - Resolved snapshot config.
 * @returns Number of `docker stats --no-stream` samples.
 */
function resolveDockerStatsSampleCount(
  config: ProdRubberbandingSnapshotConfig,
): number {
  return Math.floor((config.captureSeconds * 1_000) / config.sampleIntervalMs) + 1
}

/**
 * Builds the cgroup v2 capture command for one container.
 *
 * @param quotedContainer - Shell-quoted Docker container identifier.
 * @returns Remote shell command for CPU and memory cgroup fields.
 */
function buildCgroupCommand(quotedContainer: string): string {
  return [
    `docker exec ${quotedContainer} sh -lc`,
    shellQuote(
      [
        "printf 'cpu.stat\\n'",
        "cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true",
        "printf '\\ncpu.max\\n'",
        "cat /sys/fs/cgroup/cpu.max 2>/dev/null || true",
        "printf '\\nmemory.current\\n'",
        "cat /sys/fs/cgroup/memory.current 2>/dev/null || true",
        "printf '\\nmemory.max\\n'",
        "cat /sys/fs/cgroup/memory.max 2>/dev/null || true",
        "printf '\\nmemory.events\\n'",
        "cat /sys/fs/cgroup/memory.events 2>/dev/null || true",
      ].join("; "),
    ),
  ].join(" ")
}

/**
 * Appends host evidence completeness and cgroup delta summary rows.
 *
 * @param sections - Mutable Markdown section list.
 * @param input - Captured host sampling results.
 */
function appendHostEvidenceSummary(
  sections: string[],
  input: {
    readonly dockerStatsSampleCount: number
    readonly dockerStatsComplete: boolean
    readonly cgroupBefore: CgroupSnapshot | null
    readonly cgroupAfter: CgroupSnapshot | null
    readonly cgroupBeforeOk: boolean
    readonly cgroupAfterOk: boolean
  },
): void {
  const hostDataComplete =
    input.dockerStatsComplete &&
    input.dockerStatsSampleCount > 0 &&
    input.cgroupBeforeOk &&
    input.cgroupAfterOk &&
    input.cgroupBefore?.complete === true &&
    input.cgroupAfter?.complete === true
  const cpuStatDelta =
    input.cgroupBefore && input.cgroupAfter
      ? diffNumericRecord(input.cgroupBefore.cpuStat, input.cgroupAfter.cpuStat)
      : {}

  sections.push("## Host Evidence Summary")
  sections.push("")
  sections.push(`Host data complete: \`${hostDataComplete}\``)
  sections.push(`Docker stats samples: \`${input.dockerStatsSampleCount}\``)
  if (input.cgroupBefore && input.cgroupAfter) {
    sections.push(`cpu.max before: \`${input.cgroupBefore.cpuMax ?? "missing"}\``)
    sections.push(`cpu.max after: \`${input.cgroupAfter.cpuMax ?? "missing"}\``)
    sections.push(
      `memory.current before: \`${input.cgroupBefore.memoryCurrent ?? "missing"}\``,
    )
    sections.push(
      `memory.current after: \`${input.cgroupAfter.memoryCurrent ?? "missing"}\``,
    )
    sections.push(`memory.max before: \`${input.cgroupBefore.memoryMax ?? "missing"}\``)
    sections.push(`memory.max after: \`${input.cgroupAfter.memoryMax ?? "missing"}\``)
    for (const key of Object.keys(cpuStatDelta).sort()) {
      sections.push(`${key} delta: \`${cpuStatDelta[key]}\``)
    }
    const memoryEventDelta = diffNumericRecord(
      input.cgroupBefore.memoryEvents,
      input.cgroupAfter.memoryEvents,
    )
    for (const key of Object.keys(memoryEventDelta).sort()) {
      sections.push(`memory.events.${key} delta: \`${memoryEventDelta[key]}\``)
    }
  }
  sections.push("")
}

/**
 * Parses a cgroup v2 capture into structured fields and completeness state.
 *
 * @param stdout - Captured cgroup command output.
 * @returns Parsed cgroup snapshot.
 */
function parseCgroupSnapshot(stdout: string): CgroupSnapshot {
  const cpuStat: Record<string, number> = {}
  const memoryEvents: Record<string, number> = {}
  let section: string | null = null
  let cpuMax: string | null = null
  let memoryCurrent: number | null = null
  let memoryMax: string | null = null

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim()
    if (line === "") continue
    if (
      line === "cpu.stat" ||
      line === "cpu.max" ||
      line === "memory.current" ||
      line === "memory.max" ||
      line === "memory.events"
    ) {
      section = line
      continue
    }

    if (section === "cpu.stat") {
      const parsed = parseKeyedNumber(line)
      if (parsed) cpuStat[parsed.key] = parsed.value
      continue
    }
    if (section === "cpu.max") {
      cpuMax = line
      continue
    }
    if (section === "memory.current") {
      memoryCurrent = parseNullableNumber(line)
      continue
    }
    if (section === "memory.max") {
      memoryMax = line
      continue
    }
    if (section === "memory.events") {
      const parsed = parseKeyedNumber(line)
      if (parsed) memoryEvents[parsed.key] = parsed.value
    }
  }

  return {
    cpuStat,
    cpuMax,
    memoryCurrent,
    memoryMax,
    memoryEvents,
    complete:
      cpuMax !== null &&
      memoryCurrent !== null &&
      memoryMax !== null &&
      Object.keys(cpuStat).length > 0 &&
      Object.keys(memoryEvents).length > 0,
  }
}

/**
 * Parses a `name number` cgroup line.
 *
 * @param line - Raw line.
 * @returns Parsed key/value pair when numeric.
 */
function parseKeyedNumber(line: string): { key: string; value: number } | null {
  const [key, rawValue] = line.split(/\s+/, 2)
  const value = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN
  return key && Number.isFinite(value) ? { key, value } : null
}

/**
 * Parses a decimal number, returning null for non-numeric cgroup values.
 *
 * @param line - Raw value.
 * @returns Parsed number or null.
 */
function parseNullableNumber(line: string): number | null {
  const value = Number.parseInt(line, 10)
  return Number.isFinite(value) ? value : null
}

/**
 * Computes numeric deltas for keys present in both records.
 *
 * @param before - Baseline values.
 * @param after - Final values.
 * @returns Per-key numeric deltas.
 */
function diffNumericRecord(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Record<string, number> {
  const delta: Record<string, number> = {}
  for (const key of Object.keys(after)) {
    if (before[key] !== undefined) delta[key] = after[key] - before[key]
  }
  return delta
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
    .replaceAll(/(cookie:\s*)[^\n\r]+/gi, "$1[REDACTED]")
    .replaceAll(
      /((?:[A-Za-z0-9_]*(?:token|secret|password|private_key|database_url|auth_secret)[A-Za-z0-9_]*)\s*=\s*)[^\s'"]+/gi,
      "$1[REDACTED]",
    )
    .replaceAll(
      /((?:[A-Za-z0-9_]*(?:token|secret|password|private_key|database_url|auth_secret)[A-Za-z0-9_]*)\s*:\s*)[^\n\r]+/gi,
      "$1[REDACTED]",
    )
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
    waitBetweenSamplesMs: sleepSync,
  })
  mkdirSync(dirname(snapshot.outPath), { recursive: true })
  writeFileSync(snapshot.outPath, snapshot.markdown, "utf8")
  console.log(snapshot.outPath)
}

/**
 * Blocks the CLI between host samples to honor the requested capture window.
 *
 * @param ms - Milliseconds to wait.
 */
function sleepSync(ms: number): void {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
/* v8 ignore stop */
