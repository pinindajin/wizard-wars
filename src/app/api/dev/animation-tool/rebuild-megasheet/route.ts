import { NextResponse } from "next/server"

import { isAnimationToolApiForbiddenInProduction } from "@/shared/dev/animationToolE2eGate"

import { buildLadyWizardMegasheet } from "../../../../../../scripts/build-lady-wizard-megasheet"

export const runtime = "nodejs"

export async function POST(): Promise<NextResponse> {
  if (isAnimationToolApiForbiddenInProduction()) {
    return NextResponse.json(
      { ok: false, code: "forbidden", message: "animation tool is dev-only" },
      { status: 403 },
    )
  }

  const startedAt = Date.now()
  try {
    const result = await buildLadyWizardMegasheet({ silent: true })
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
