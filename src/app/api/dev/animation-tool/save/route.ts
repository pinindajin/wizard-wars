import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { NextResponse } from "next/server"

import {
  ANIMATION_CONFIG_SCHEMA_VERSION,
  animationConfigSchema,
  type AnimationToolSave,
} from "@/shared/balance-config/animationConfig"

export const runtime = "nodejs"

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-")
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "animation tool is dev-only" }, { status: 403 })
  }

  const body = (await request.json()) as unknown
  const parsed = animationConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid animation config", issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const config = parsed.data
  const savedAt = new Date()
  const save: AnimationToolSave = {
    schemaVersion: ANIMATION_CONFIG_SCHEMA_VERSION,
    savedAt: savedAt.toISOString(),
    config,
  }

  const outputDir = resolve(process.cwd(), "tools/animation/output")
  const timestampedPath = resolve(outputDir, `${safeTimestamp(savedAt)}.json`)
  const latestPath = resolve(outputDir, "latest.json")
  const payload = `${JSON.stringify(save, null, 2)}\n`

  await mkdir(outputDir, { recursive: true })
  await writeFile(timestampedPath, payload, "utf8")
  await writeFile(latestPath, payload, "utf8")

  return NextResponse.json({
    ok: true,
    savedAt: save.savedAt,
    path: timestampedPath,
  })
}
