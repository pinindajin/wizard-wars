import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { POST } from "./route"

const cwd = process.cwd()
const targetMp3 = join(cwd, "public/assets/sounds/sfx-fireball-cast.mp3")
const donorMp3 = join(cwd, "public/assets/sounds/sfx-lightning-cast.mp3")
const archiveTestRoot = join(cwd, ".tmp-animation-tool-sfx-archive-test")

const originalNodeEnv = process.env.NODE_ENV
const originalArchiveEnv = process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR

let snapshot: Buffer | null = null

function setNodeEnv(value: string | undefined): void {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  })
}

function buildRequest(form: FormData): Request {
  return new Request("http://localhost/api/dev/animation-tool/import-sound", {
    method: "POST",
    body: form,
  })
}

beforeEach(async () => {
  snapshot = await readFile(targetMp3)
  process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR = archiveTestRoot
  await mkdir(archiveTestRoot, { recursive: true })
})

afterEach(async () => {
  if (originalArchiveEnv === undefined) {
    delete process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR
  } else {
    process.env.WW_ANIMATION_TOOL_SFX_ARCHIVE_DIR = originalArchiveEnv
  }
  setNodeEnv(originalNodeEnv)
  if (snapshot) {
    await writeFile(targetMp3, snapshot)
  }
  await rm(archiveTestRoot, { recursive: true, force: true })
})

describe("animation tool import-sound route", () => {
  it("rejects production", async () => {
    setNodeEnv("production")
    const donor = await readFile(donorMp3)
    const form = new FormData()
    form.set("confirmReplace", "true")
    form.set("heroId", "red_wizard")
    form.set("actionId", "spell:fireball")
    form.set("file", new File([new Uint8Array(donor)], "x.mp3", { type: "audio/mpeg" }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(403)
  })

  it("rejects missing confirmReplace", async () => {
    setNodeEnv("development")
    const donor = await readFile(donorMp3)
    const form = new FormData()
    form.set("heroId", "red_wizard")
    form.set("actionId", "spell:fireball")
    form.set("file", new File([new Uint8Array(donor)], "x.mp3", { type: "audio/mpeg" }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
  })

  it("rejects confirmReplace not true", async () => {
    setNodeEnv("development")
    const donor = await readFile(donorMp3)
    const form = new FormData()
    form.set("confirmReplace", "yes")
    form.set("heroId", "red_wizard")
    form.set("actionId", "spell:fireball")
    form.set("file", new File([new Uint8Array(donor)], "x.mp3", { type: "audio/mpeg" }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
  })

  it("rejects unmapped action", async () => {
    setNodeEnv("development")
    const donor = await readFile(donorMp3)
    const form = new FormData()
    form.set("confirmReplace", "true")
    form.set("heroId", "red_wizard")
    form.set("actionId", "idle")
    form.set("file", new File([new Uint8Array(donor)], "x.mp3", { type: "audio/mpeg" }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(400)
  })

  it("replaces mp3 and archives prior", async () => {
    setNodeEnv("development")
    const donor = await readFile(donorMp3)
    const form = new FormData()
    form.set("confirmReplace", "true")
    form.set("heroId", "red_wizard")
    form.set("actionId", "spell:fireball")
    form.set("file", new File([new Uint8Array(donor)], "cast.mp3", { type: "audio/mpeg" }))
    const res = await POST(buildRequest(form))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; sfxKey?: string; publicPath?: string }
    expect(body.ok).toBe(true)
    expect(body.sfxKey).toBe("sfx-fireball-cast")
    const written = await readFile(targetMp3)
    expect(written.equals(donor)).toBe(true)

    async function findArchived(): Promise<string[]> {
      const out: string[] = []
      const sfxRoot = join(archiveTestRoot, "wizard-wars", "sfx")
      if (!existsSync(sfxRoot)) return out
      for (const day of await readdir(sfxRoot)) {
        const dayDir = join(sfxRoot, day)
        for (const f of await readdir(dayDir)) {
          if (f.endsWith(".mp3")) out.push(join(dayDir, f))
        }
      }
      return out
    }
    const archivedFiles = await findArchived()
    expect(archivedFiles.length).toBeGreaterThanOrEqual(1)
    const archBuf = await readFile(archivedFiles[0]!)
    expect(archBuf.equals(snapshot!)).toBe(true)
  })
})
