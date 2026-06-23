import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"

type CommandResult = {
  readonly label: string
  readonly command: string
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

const DEFAULT_PROD_URL = "https://wizard-wars.pinindajin.online"

const prodUrl = process.env.WW_PROD_URL ?? DEFAULT_PROD_URL
const sshHost = process.env.WW_PROD_SSH_HOST
const prodContainer = process.env.WW_PROD_CONTAINER
const outPath =
  process.env.WW_PROD_SNAPSHOT_OUT ??
  join(
    process.cwd(),
    "test-results",
    "prod-rubberbanding",
    `${new Date().toISOString().replaceAll(":", "-")}.md`,
  )

const sections: string[] = []

sections.push(`# Production Rubber-Banding Snapshot`)
sections.push(``)
sections.push(`Captured at: ${new Date().toISOString()}`)
sections.push(`Production URL: ${prodUrl}`)
sections.push(``)

appendResult("current commit", run("git", ["rev-parse", "HEAD"]))
appendResult(
  "origin main/prod refs",
  run("git", ["ls-remote", "--heads", "origin", "main", "prod"]),
)
appendResult(
  "production response headers",
  run("curl", ["-fsSI", "--connect-timeout", "10", "--max-time", "20", prodUrl]),
)

if (sshHost) {
  appendResult(
    "remote docker containers",
    runSsh(
      "docker ps --format 'table {{.ID}}\\t{{.Image}}\\t{{.Names}}\\t{{.Status}}'",
    ),
  )
  appendResult("remote docker stats", runSsh("docker stats --no-stream"))

  if (prodContainer) {
    const container = shellQuote(prodContainer)
    appendResult(
      "target container image and resource limits",
      runSsh(
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
      "target container cgroup cpu/memory",
      runSsh(
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
    sections.push(`## Target Container`)
    sections.push(``)
    sections.push(
      "`WW_PROD_CONTAINER` was not set, so image digest, resource limits, and cgroup throttling were not captured for a specific container.",
    )
    sections.push(``)
  }
} else {
  sections.push(`## Remote Host`)
  sections.push(``)
  sections.push(
    "`WW_PROD_SSH_HOST` was not set, so Dokploy/container CPU, memory, replica, and cgroup throttling data were not captured.",
  )
  sections.push(``)
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${sections.join("\n")}\n`, "utf8")
console.log(outPath)

function appendResult(label: string, result: CommandResult): void {
  sections.push(`## ${label}`)
  sections.push(``)
  sections.push(`Command: \`${result.command}\``)
  sections.push(`Exit: ${result.ok ? "0" : "non-zero"}`)
  sections.push(``)
  if (result.stdout.trim() !== "") {
    sections.push("```text")
    sections.push(result.stdout.trimEnd())
    sections.push("```")
    sections.push(``)
  }
  if (result.stderr.trim() !== "") {
    sections.push("stderr:")
    sections.push("```text")
    sections.push(result.stderr.trimEnd())
    sections.push("```")
    sections.push(``)
  }
}

function run(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
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

function runSsh(remoteCommand: string): CommandResult {
  if (!sshHost) throw new Error("WW_PROD_SSH_HOST is required")
  const result = spawnSync("ssh", [sshHost, remoteCommand], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  return {
    label: "ssh",
    command: ["ssh", shellQuote(sshHost), shellQuote(remoteCommand)].join(" "),
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}
