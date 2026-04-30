import type { Metadata } from "next"

import { AnimationToolClient } from "./AnimationToolClient"

export const metadata: Metadata = {
  title: "Wizard Wars — Animation tool",
  description: "Dev-only tool for tuning hero animation timing.",
}

export default function AnimationToolPage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
        <div className="mx-auto max-w-2xl rounded border border-amber-700/60 bg-amber-950/30 p-6">
          <h1 className="font-mono text-xl">Animation tool unavailable</h1>
          <p className="mt-2 text-sm text-amber-100/80">
            This route is disabled outside development so production cannot edit local animation
            timing.
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
