import { NextResponse } from "next/server"

import { isAnimationToolApiForbiddenInProduction } from "@/shared/dev/animationToolE2eGate"
import { normalizeHeroId } from "@/shared/balance-config/heroes"

import { buildHeroMegasheet } from "../../../../../../scripts/build-hero-megasheet"

export const runtime = "nodejs"

/**
 * Rebuilds one hero megasheet for the dev animation tool.
 *
 * @param request - Optional JSON body with `heroId`; missing body defaults to Yen.
 * @returns JSON rebuild result.
 */
export async function POST(request?: Request): Promise<NextResponse> {
  if (isAnimationToolApiForbiddenInProduction()) {
    return NextResponse.json(
      { ok: false, code: "forbidden", message: "animation tool is dev-only" },
      { status: 403 },
    )
  }

  const startedAt = Date.now()
  try {
    let heroId = "yen"
    if (request) {
      try {
        const body = (await request.json()) as { heroId?: unknown }
        heroId = String(body.heroId ?? "yen")
      } catch {
        heroId = "yen"
      }
    }
    const result = await buildHeroMegasheet({ heroId: normalizeHeroId(heroId), silent: true })
    const durationMs = Date.now() - startedAt
    return NextResponse.json({
      ok: true,
      rebuiltAt: new Date().toISOString(),
      durationMs,
      outputPath: result.outputPath,
      width: result.width,
      height: result.height,
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        code: "rebuild_failed",
        message: (e as Error).message,
      },
      { status: 500 },
    )
  }
}
