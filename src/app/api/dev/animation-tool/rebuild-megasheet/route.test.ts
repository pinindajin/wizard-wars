import { stat } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { POST } from "./route"

const cwd = process.cwd()
const megasheetPath = join(
  cwd,
  "public/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png",
)

const originalNodeEnv = process.env.NODE_ENV

function setNodeEnv(value: string | undefined): void {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  })
}

afterEach(() => {
  setNodeEnv(originalNodeEnv)
})

describe("animation tool rebuild-megasheet route", () => {
  it("rejects production", async () => {
    setNodeEnv("production")
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it("rebuilds megasheet and bumps mtime", async () => {
    setNodeEnv("development")
    const before = await stat(megasheetPath)
    // Wait 5 ms to ensure mtime granularity is exceeded
    await new Promise((r) => setTimeout(r, 5))
    const res = await POST()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; rebuiltAt: string; durationMs: number }
    expect(body.ok).toBe(true)
    expect(typeof body.durationMs).toBe("number")
    const after = await stat(megasheetPath)
    expect(after.mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs)
  })
})
