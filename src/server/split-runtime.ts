import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

import { logger } from "./logger"

export type SplitRuntimeConfig = {
  readonly webPort: string
  readonly realtimePort: string
  readonly realtimeUrl: string
  readonly adminToken: string
}

export type SplitRuntimeChildSpec = {
  readonly name: "realtime" | "web"
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

type SplitRuntimeRunOptions = {
  readonly shutdownTimeoutMs?: number
}

type SplitRuntimeEnv = {
  readonly PORT?: string | undefined
  readonly WW_REALTIME_PORT?: string | undefined
  readonly WW_REALTIME_ADMIN_TOKEN?: string | undefined
  readonly [key: string]: string | undefined
}

type SplitRuntimeBuildOptions = {
  readonly bunExecutable?: string | undefined
  readonly cwd?: string | undefined
  readonly baseEnv?: NodeJS.ProcessEnv | undefined
}

const DEFAULT_SPLIT_RUNTIME_SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * Resolves ports and shared service auth for the single-container split runtime.
 *
 * @param env - Environment map to read.
 * @param createToken - Token generator used when no shared token is configured.
 * @returns Split runtime configuration.
 */
export function resolveSplitRuntimeConfig(
  env: SplitRuntimeEnv = process.env,
  createToken: () => string = randomUUID,
): SplitRuntimeConfig {
  const webPort = env.PORT?.trim() || "3000"
  const realtimePort = env.WW_REALTIME_PORT?.trim() || "3001"
  const adminToken = env.WW_REALTIME_ADMIN_TOKEN?.trim() || createToken()
  return {
    webPort,
    realtimePort,
    realtimeUrl: `http://127.0.0.1:${realtimePort}`,
    adminToken,
  }
}

/**
 * Builds child process specs for sibling realtime and web processes.
 *
 * @param config - Split runtime configuration.
 * @param options - Process launch options.
 * @returns Child process specs in startup order.
 */
export function buildSplitRuntimeChildSpecs(
  config: SplitRuntimeConfig,
  options: SplitRuntimeBuildOptions = {},
): readonly SplitRuntimeChildSpec[] {
  const baseEnv = options.baseEnv ?? process.env
  const bunExecutable = options.bunExecutable ?? process.env.BUN_EXECUTABLE ?? "bun"
  const cwd = options.cwd ?? process.cwd()
  const commonEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    NODE_ENV: "production",
    RUN_MIGRATIONS: "false",
    WW_REALTIME_ADMIN_TOKEN: config.adminToken,
  }

  return [
    {
      name: "realtime",
      command: bunExecutable,
      args: ["src/server/colyseus/realtime-server.ts"],
      cwd,
      env: {
        ...commonEnv,
        WW_SERVER_MODE: "realtime",
        PORT: config.realtimePort,
      },
    },
    {
      name: "web",
      command: bunExecutable,
      args: ["server.ts"],
      cwd,
      env: {
        ...commonEnv,
        WW_SERVER_MODE: "web",
        PORT: config.webPort,
        WW_REALTIME_ADMIN_URL: config.realtimeUrl,
        WW_REALTIME_PROXY_URL: config.realtimeUrl,
      },
    },
  ]
}

/**
 * Starts realtime and web processes, then exits when either child exits.
 *
 * @param specs - Child process specs.
 * @returns Exit code to use for the supervisor process.
 */
export async function runSplitRuntime(
  specs: readonly SplitRuntimeChildSpec[] = buildSplitRuntimeChildSpecs(
    resolveSplitRuntimeConfig(),
  ),
  options: SplitRuntimeRunOptions = {},
): Promise<number> {
  const children = specs.map((spec) => startChild(spec))
  const exitedChildren = new Set<ChildProcess>()
  let shuttingDown = false
  let resolved = false
  let shutdownExitCode = 0
  const shutdownTimeoutMs =
    options.shutdownTimeoutMs ?? DEFAULT_SPLIT_RUNTIME_SHUTDOWN_TIMEOUT_MS

  return await new Promise<number>((resolve) => {
    const handleSigterm = (): void => shutdown(0, "SIGTERM")
    const handleSigint = (): void => shutdown(0, "SIGINT")
    let shutdownTimeout: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      process.off("SIGTERM", handleSigterm)
      process.off("SIGINT", handleSigint)
      if (shutdownTimeout) clearTimeout(shutdownTimeout)
    }

    const finish = (exitCode: number): void => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve(exitCode)
    }

    const maybeFinishShutdown = (): void => {
      if (!shuttingDown) return
      if (exitedChildren.size >= children.length) {
        finish(shutdownExitCode)
      }
    }

    const shutdown = (exitCode: number, signal: NodeJS.Signals = "SIGTERM"): void => {
      if (shuttingDown) return
      shuttingDown = true
      shutdownExitCode = exitCode
      for (const child of children) {
        if (!exitedChildren.has(child) && !child.killed) child.kill(signal)
      }
      maybeFinishShutdown()
      if (resolved) return
      shutdownTimeout = setTimeout(() => {
        for (const child of children) {
          if (!exitedChildren.has(child)) child.kill("SIGKILL")
        }
        logger.error(
          {
            event: "split_runtime.shutdown_timeout",
            timeoutMs: shutdownTimeoutMs,
          },
          "Split runtime child shutdown timed out",
        )
        finish(exitCode)
      }, shutdownTimeoutMs)
    }

    for (const child of children) {
      child.once("error", (err) => {
        exitedChildren.add(child)
        logger.error(
          { event: "split_runtime.child.spawn_failed", child: child.spawnargs.join(" "), err },
          "Split runtime child failed to spawn",
        )
        if (shuttingDown) {
          maybeFinishShutdown()
          return
        }
        shutdown(1)
      })
      child.once("exit", (code, signal) => {
        exitedChildren.add(child)
        const exitCode = code ?? (signal ? 1 : 0)
        if (!shuttingDown) {
          logger.error(
            { event: "split_runtime.child.exited", child: child.spawnargs.join(" "), code, signal },
            "Split runtime child exited",
          )
          shutdown(exitCode)
          return
        }
        maybeFinishShutdown()
      })
    }

    process.once("SIGTERM", handleSigterm)
    process.once("SIGINT", handleSigint)
  })
}

/**
 * Starts one child process with inherited stdio.
 *
 * @param spec - Child process spec.
 * @returns Spawned child process.
 */
function startChild(spec: SplitRuntimeChildSpec): ChildProcess {
  logger.info(
    { event: "split_runtime.child.starting", role: spec.name, command: spec.command, args: spec.args },
    "Starting split runtime child",
  )
  return spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    stdio: "inherit",
  })
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (invokedPath === import.meta.url) {
  runSplitRuntime().then((exitCode) => {
    process.exit(exitCode)
  }).catch((err: unknown) => {
    logger.fatal({ event: "split_runtime.failed", err }, "Split runtime failed")
    process.exit(1)
  })
}
