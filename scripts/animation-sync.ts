import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { parseAnimationToolSave } from "../src/shared/balance-config/animationConfig"

type AnimationSyncDeps = {
  readonly cwd: string
  readonly readFile: typeof readFileSync
  readonly writeFile: typeof writeFileSync
  readonly log: (message: string) => void
  readonly error: (message: string) => void
}

type AnimationSyncResult = {
  readonly latestPath: string
  readonly configPath: string
}

export function createAnimationSyncDeps(cwd = process.cwd()): AnimationSyncDeps {
  return {
    cwd,
    readFile: readFileSync,
    writeFile: writeFileSync,
    log: console.log,
    error: console.error,
  }
}

export function syncAnimationConfig(
  deps: AnimationSyncDeps = createAnimationSyncDeps(),
): AnimationSyncResult {
  const latestPath = resolve(deps.cwd, "tools/animation/output/latest.json")
  const configPath = resolve(deps.cwd, "src/shared/balance-config/animation-config.json")
  const raw = JSON.parse(deps.readFile(latestPath, "utf8") as string) as unknown
  const save = parseAnimationToolSave(raw)
  deps.writeFile(configPath, `${JSON.stringify(save.config, null, 2)}\n`)
  return { latestPath, configPath }
}

export function runAnimationSync(deps: AnimationSyncDeps = createAnimationSyncDeps()): number {
  try {
    const { latestPath, configPath } = syncAnimationConfig(deps)
    deps.log(`synced ${latestPath} -> ${configPath}`)
    return 0
  } catch (error) {
    deps.error("animation sync failed")
    if (error instanceof Error) deps.error(error.message)
    return 1
  }
}

/* v8 ignore next 3 -- exercised by running `bun run dev:animation-sync` directly. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runAnimationSync()
}
