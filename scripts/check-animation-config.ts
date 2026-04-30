import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { parseAnimationConfig } from "../src/shared/balance-config/animationConfig"

type CheckAnimationConfigDeps = {
  readonly cwd: string
  readonly readFile: typeof readFileSync
  readonly log: (message: string) => void
  readonly error: (message: string) => void
}

type CheckAnimationConfigResult = {
  readonly configPath: string
}

export function createCheckAnimationConfigDeps(cwd = process.cwd()): CheckAnimationConfigDeps {
  return {
    cwd,
    readFile: readFileSync,
    log: console.log,
    error: console.error,
  }
}

export function checkAnimationConfig(
  deps: CheckAnimationConfigDeps = createCheckAnimationConfigDeps(),
): CheckAnimationConfigResult {
  const configPath = resolve(deps.cwd, "src/shared/balance-config/animation-config.json")
  const raw = JSON.parse(deps.readFile(configPath, "utf8") as string) as unknown
  parseAnimationConfig(raw)
  return { configPath }
}

export function runCheckAnimationConfig(
  deps: CheckAnimationConfigDeps = createCheckAnimationConfigDeps(),
): number {
  try {
    const { configPath } = checkAnimationConfig(deps)
    deps.log(`animation config valid: ${configPath}`)
    return 0
  } catch (error) {
    deps.error("animation config invalid")
    if (error instanceof Error) deps.error(error.message)
    return 1
  }
}

/* v8 ignore next 3 -- exercised by running `bun run check:animation-config` directly. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runCheckAnimationConfig()
}
