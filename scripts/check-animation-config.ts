import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { parseAnimationConfig } from "../src/shared/balance-config/animationConfig"

const configPath = resolve(process.cwd(), "src/shared/balance-config/animation-config.json")

try {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown
  parseAnimationConfig(raw)
  console.log(`animation config valid: ${configPath}`)
} catch (error) {
  console.error("animation config invalid")
  if (error instanceof Error) console.error(error.message)
  process.exit(1)
}
