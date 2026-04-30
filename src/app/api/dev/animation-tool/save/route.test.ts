import { mkdir, readdir, unlink } from "node:fs/promises"
import { resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { ANIMATION_CONFIG } from "@/shared/balance-config/animationConfig"
import { POST } from "./route"

const outputDir = resolve(process.cwd(), "tools/animation/output")
const originalNodeEnv = process.env.NODE_ENV

function setNodeEnv(value: string | undefined): void {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  })
}

afterEach(async () => {
  setNodeEnv(originalNodeEnv)
  await mkdir(outputDir, { recursive: true })
  for (const filename of await readdir(outputDir)) {
    if (filename.endsWith(".json")) {
      await unlink(resolve(outputDir, filename))
    }
  }
})

describe("animation tool save route", () => {
  it("rejects production saves", async () => {
    setNodeEnv("production")

    const response = await POST(
      new Request("http://localhost/api/dev/animation-tool/save", {
        method: "POST",
        body: JSON.stringify(ANIMATION_CONFIG),
      }),
    )

    expect(response.status).toBe(403)
  })

  it("rejects invalid config in dev", async () => {
    setNodeEnv("development")

    const response = await POST(
      new Request("http://localhost/api/dev/animation-tool/save", {
        method: "POST",
        body: JSON.stringify({ schemaVersion: 1, heroes: {} }),
      }),
    )

    expect(response.status).toBe(400)
  })

  it("writes latest snapshot in dev", async () => {
    setNodeEnv("development")
    await mkdir(outputDir, { recursive: true })

    const response = await POST(
      new Request("http://localhost/api/dev/animation-tool/save", {
        method: "POST",
        body: JSON.stringify(ANIMATION_CONFIG),
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
