import type { Metadata } from "next"
import { unstable_noStore as noStore } from "next/cache"

import { AnimationToolClient } from "./AnimationToolClient"

export const metadata: Metadata = {
  title: "Wizard Wars — Animation tool",
  description: "Dev-only tool for tuning hero animation timing.",
}

/**
 * Evaluate env per request so Playwright (`bun run start` + E2E flags) can hit this route against
 * `NODE_ENV=production` without baking a static shell at build time.
 */
export const dynamic = "force-dynamic"

/**
 * Production server may enable the tool only for automated tests (never set on real hosts).
 *
 * @returns True when `/dev/animation-tool` should render in a production Node process.
 */
function allowAnimationToolInProduction(): boolean {
  return (
    process.env.WIZARD_WARS_E2E === "1" ||
    process.env.WW_ALLOW_ANIMATION_TOOL_IN_PRODUCTION_E2E === "1"
  )
}

/**
 * Returns true when the animation tool page body must not render (production without E2E gate).
 */
function isAnimationToolUnavailable(): boolean {
  if (process.env.NODE_ENV !== "production") return false
  return !allowAnimationToolInProduction()
}

export default function AnimationToolPage() {
  noStore()

  if (isAnimationToolUnavailable()) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
        <div className="mx-auto max-w-2xl rounded border border-amber-700/60 bg-amber-950/30 p-6">
          <h1 className="font-mono text-xl">Animation tool unavailable</h1>
          <p className="mt-2 text-sm text-amber-100/80">
            This route is disabled outside development so production cannot edit local animation timing.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#10100d] text-stone-100">
      <AnimationToolClient />
    </main>
  )
}
