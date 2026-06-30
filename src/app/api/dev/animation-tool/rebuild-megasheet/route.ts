import { NextResponse } from "next/server"

import { isAnimationToolApiForbiddenInProduction } from "@/shared/dev/animationToolE2eGate"
import { DEFAULT_HERO_ID, VALID_HERO_IDS, type HeroId } from "@/shared/balance-config/heroes"

import { buildHeroMegasheet } from "../../../../../../scripts/build-hero-megasheet"

export const runtime = "nodejs"

function validationFailed(message: string): NextResponse {
  return NextResponse.json({ ok: false, code: "validation_failed", message }, { status: 400 })
}

function parseWritableHeroId(rawHeroId: unknown): HeroId | NextResponse {
  if (rawHeroId === undefined) return DEFAULT_HERO_ID
  if (
    typeof rawHeroId === "string" &&
    (VALID_HERO_IDS as readonly string[]).includes(rawHeroId)
  ) {
    return rawHeroId as HeroId
  }
  return validationFailed(`unknown heroId: ${String(rawHeroId)}`)
}

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
    let rawHeroId: unknown
    if (request) {
      try {
        const body = (await request.json()) as unknown
        rawHeroId =
          body !== null && typeof body === "object" && "heroId" in body
            ? (body as { heroId?: unknown }).heroId
            : undefined
      } catch {
        rawHeroId = undefined
      }
    }
    const heroId = parseWritableHeroId(rawHeroId)
    if (heroId instanceof NextResponse) return heroId

    const result = await buildHeroMegasheet({ heroId, silent: true })
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
