import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { parseAnimationToolSave } from "../src/shared/balance-config/animationConfig"

const latestPath = resolve(process.cwd(), "tools/animation/output/latest.json")
const configPath = resolve(process.cwd(), "src/shared/balance-config/animation-config.json")

try {
  const raw = JSON.parse(readFileSync(latestPath, "utf8")) as unknown
  const save = parseAnimationToolSave(raw)
  writeFileSync(configPath, `${JSON.stringify(save.config, null, 2)}\n`)
  console.log(`synced ${latestPath} -> ${configPath}`)
} catch (error) {
  console.error("animation sync failed")
  if (error instanceof Error) console.error(error.message)
  process.exit(1)
}
