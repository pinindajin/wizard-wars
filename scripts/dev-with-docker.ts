import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Runs `docker compose up` for database backing services, waits until they are healthy,
 * then starts the local Next/Colyseus dev server (not containerized).
 */
async function main(): Promise<void> {
  const up = Bun.spawn({
    cmd: [
      "docker",
      "compose",
      "up",
      "-d",
      "--wait",
      "db",
      "db-shadow",
    ],
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  })
  const upCode = await up.exited
  if (upCode !== 0) {
    process.exit(upCode ?? 1)
  }

  const dev = Bun.spawn({
    cmd: ["bun", "run", "dev"],
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  })

  const forward = (signal: NodeJS.Signals) => {
    try {
      dev.kill(signal)
    } catch {
      // Process may already be gone.
    }
  }
  process.on("SIGINT", () => forward("SIGINT"))
  process.on("SIGTERM", () => forward("SIGTERM"))

  const code = await dev.exited
  process.exit(code ?? 0)
}

void main()
