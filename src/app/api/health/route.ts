import { NextResponse } from "next/server"

import { prisma } from "@/server/db"

export const dynamic = "force-dynamic"

/**
 * Health check: confirms the app can serve a Route Handler and reach Postgres.
 *
 * @returns JSON with `ok: true` and `database: "up"` on success, or `ok: false` with error details on failure.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true, database: "up" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error"
    return NextResponse.json({ ok: false, database: "down", error: message }, { status: 503 })
  }
}
