import { stat } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { POST } from "./route"

const cwd = process.cwd()
const megasheetPath = join(
  cwd,
  "public/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png",
)
const trissMegasheetPath = join(
  cwd,
  "public/assets/sprites/heroes/triss/sheets/triss-megasheet.png",
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

  it("defaults to Yen when request JSON cannot be parsed", async () => {
    setNodeEnv("development")
    const before = await stat(megasheetPath)
    await new Promise((r) => setTimeout(r, 5))
    const req = new Request("http://localhost/api/dev/animation-tool/rebuild-megasheet", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; outputPath: string }
    expect(body.ok).toBe(true)
    expect(body.outputPath).toContain("lady-wizard-megasheet.png")
    const after = await stat(megasheetPath)
    expect(after.mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs)
  })

  it("rebuilds the selected Triss megasheet", async () => {
    setNodeEnv("development")
    const before = await stat(trissMegasheetPath)
    await new Promise((r) => setTimeout(r, 5))
    const req = new Request("http://localhost/api/dev/animation-tool/rebuild-megasheet", {
      method: "POST",
      body: JSON.stringify({ heroId: "triss" }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; outputPath: string; width: number; height: number }
    expect(body.ok).toBe(true)
    expect(body.outputPath).toContain("triss-megasheet.png")
    expect(body.width).toBe(14880)
    expect(body.height).toBe(992)
    const after = await stat(trissMegasheetPath)
    expect(after.mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs)
  })
})
