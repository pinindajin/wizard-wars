import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import sharp from "sharp"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { POST } from "./route"

const HERO_DIR = "public/assets/sprites/heroes/lady-wizard"
const cwd = process.cwd()
const liveStrip = join(cwd, HERO_DIR, "sheets/walk-east.png")
const sheetsArchiveDir = join(cwd, HERO_DIR, "sheets/old")
const liveFramesDir = join(cwd, HERO_DIR, "animations/walk/east")
const framesArchiveRoot = join(cwd, HERO_DIR, "animations/old/walk")

const originalNodeEnv = process.env.NODE_ENV

function setNodeEnv(value: string | undefined): void {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  })
}

let stripSnapshot: Buffer | null = null
let framesSnapshot: { name: string; data: Buffer }[] = []

async function snapshotLive(): Promise<void> {
  stripSnapshot = existsSync(liveStrip) ? await readFile(liveStrip) : null
  framesSnapshot = []
  if (existsSync(liveFramesDir)) {
    for (const name of await readdir(liveFramesDir)) {
      framesSnapshot.push({ name, data: await readFile(join(liveFramesDir, name)) })
    }
  }
}

async function restoreLive(): Promise<void> {
  if (stripSnapshot) {
    await writeFile(liveStrip, stripSnapshot)
  }
  await rm(liveFramesDir, { recursive: true, force: true })
  await mkdir(liveFramesDir, { recursive: true })
  for (const f of framesSnapshot) {
    await writeFile(join(liveFramesDir, f.name), f.data)
  }
  if (existsSync(sheetsArchiveDir)) {
    for (const f of await readdir(sheetsArchiveDir)) {
      if (f.startsWith("walk-east-")) {
        await rm(join(sheetsArchiveDir, f), { force: true })
      }
    }
  }
  if (existsSync(framesArchiveRoot)) {
    for (const f of await readdir(framesArchiveRoot)) {
      if (f.startsWith("east-")) {
        await rm(join(framesArchiveRoot, f), { recursive: true, force: true })
      }
    }
  }
}

async function makeStripBuffer(frameCount: number, h = 124, w = 124): Promise<Buffer> {
  return sharp({
    create: {
      width: frameCount * w,
      height: h,
      channels: 4,
      background: { r: 200, g: 50, b: 50, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
}

async function makeJpegBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 124,
      height: 124,
      channels: 3,
      background: { r: 100, g: 100, b: 100 },
    },
  })
    .jpeg()
    .toBuffer()
}

function buildRequest(form: FormData): Request {
  return new Request("http://localhost/api/dev/animation-tool/replace-sheet", {
    method: "POST",
    body: form,
  })
}

beforeAll(async () => {
  await snapshotLive()
})

afterEach(async () => {
  setNodeEnv(originalNodeEnv)
  await restoreLive()
})

afterAll(async () => {
  await restoreLive()
})

describe("animation tool replace-sheet route", () => {
  it("rejects production", async () => {
    setNodeEnv("production")
    const form = new FormData()
    form.set("atlasClipId", "walk")
    form.set("direction", "east")
    form.set(
      "file",
      new File([new Uint8Array(await makeStripBuffer(15))], "x.png", { type: "image/png" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(403)
  })

  it("rejects unknown atlasClipId", async () => {
    setNodeEnv("development")
    const form = new FormData()
    form.set("atlasClipId", "made-up")
    form.set("direction", "east")
    form.set(
      "file",
      new File([new Uint8Array(await makeStripBuffer(15))], "x.png", { type: "image/png" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe("validation_failed")
    expect(body.message).toContain("atlasClipId")
  })

  it("rejects unknown direction", async () => {
    setNodeEnv("development")
    const form = new FormData()
    form.set("atlasClipId", "walk")
    form.set("direction", "upward")
    form.set(
      "file",
      new File([new Uint8Array(await makeStripBuffer(15))], "x.png", { type: "image/png" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("validation_failed")
  })

  it("rejects clip+direction missing from atlas (e.g. light-spell-cast/south-west)", async () => {
    setNodeEnv("development")
    const form = new FormData()
    form.set("atlasClipId", "light-spell-cast")
    form.set("direction", "south-west")
    form.set(
      "file",
      new File([new Uint8Array(await makeStripBuffer(17))], "x.png", { type: "image/png" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe("validation_failed")
    expect(body.message).toContain("no atlas entry")
  })

  it("rejects non-PNG", async () => {
    setNodeEnv("development")
    const form = new FormData()
    form.set("atlasClipId", "walk")
    form.set("direction", "east")
    form.set(
      "file",
      new File([new Uint8Array(await makeJpegBuffer())], "x.jpg", { type: "image/jpeg" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe("validation_failed")
    expect(body.message).toMatch(/png/)
  })

  it("rejects wrong width (frame count mismatch)", async () => {
    setNodeEnv("development")
    const form = new FormData()
    form.set("atlasClipId", "walk")
    form.set("direction", "east")
    form.set(
      "file",
      new File([new Uint8Array(await makeStripBuffer(14))], "x.png", { type: "image/png" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe("validation_failed")
    expect(body.message).toMatch(/expected 1860/)
  })

  it("rejects wrong height", async () => {
    setNodeEnv("development")
    const form = new FormData()
    form.set("atlasClipId", "walk")
    form.set("direction", "east")
    form.set(
      "file",
      new File([new Uint8Array(await makeStripBuffer(15, 100))], "x.png", { type: "image/png" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe("validation_failed")
  })

  it("happy path: archives strip + frames, writes new strip, slices new frames", async () => {
    setNodeEnv("development")
    const newBuffer = await makeStripBuffer(15)
    const form = new FormData()
    form.set("atlasClipId", "walk")
    form.set("direction", "east")
    form.set(
      "file",
      new File([new Uint8Array(newBuffer)], "walk-east.png", { type: "image/png" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      version: string
      stripArchivePath: string | null
      framesArchivePath: string | null
      frameCount: number
    }
    expect(body.ok).toBe(true)
    expect(body.frameCount).toBe(15)
    expect(body.stripArchivePath).toBeTruthy()
    expect(body.framesArchivePath).toBeTruthy()

    // Live strip is the new bytes (compare via sharp metadata + first pixel)
    const liveBytes = await readFile(liveStrip)
    expect(liveBytes.equals(newBuffer)).toBe(true)

    // Strip archive contains prior bytes
    const archived = await readFile(body.stripArchivePath!)
    if (stripSnapshot) {
      expect(archived.equals(stripSnapshot)).toBe(true)
    }

    // Live frames dir has 15 sliced frames
    const liveFrames = (await readdir(liveFramesDir)).filter((f) => f.endsWith(".png")).sort()
    expect(liveFrames.length).toBe(15)
    // Each frame is 124x124 PNG
    const meta = await sharp(join(liveFramesDir, liveFrames[0]!)).metadata()
    expect(meta.width).toBe(124)
    expect(meta.height).toBe(124)
    expect(meta.format).toBe("png")

    // Frames archive present
    expect(existsSync(body.framesArchivePath!)).toBe(true)
  })

  it("happy path with no live strip: writes new, no strip archive entry", async () => {
    setNodeEnv("development")
    // Remove live strip beforehand
    await rm(liveStrip, { force: true })
    const newBuffer = await makeStripBuffer(15)
    const form = new FormData()
    form.set("atlasClipId", "walk")
    form.set("direction", "east")
    form.set(
      "file",
      new File([new Uint8Array(newBuffer)], "walk-east.png", { type: "image/png" }),
    )
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { stripArchivePath: string | null }
    expect(body.stripArchivePath).toBeNull()
    expect(existsSync(liveStrip)).toBe(true)
  })

  it("rejects file too large", async () => {
    setNodeEnv("development")
    // 11 MB junk buffer
    const big = Buffer.alloc(11 * 1024 * 1024, 0)
    const form = new FormData()
    form.set("atlasClipId", "walk")
    form.set("direction", "east")
    form.set("file", new File([new Uint8Array(big)], "big.png", { type: "image/png" }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe("validation_failed")
    expect(body.message).toMatch(/too large/)
  })
})
