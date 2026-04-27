import type { Metadata } from "next"

import { SpriteViewerClient } from "./SpriteViewerClient"

export const metadata: Metadata = {
  title: "Wizard Wars — Sprite viewer",
  description: "Dev tool: inspect shipped lady-wizard sprite strips and overlays.",
}

/**
 * Public dev route: canvas-based inspector for lady-wizard atlas strips (no Phaser, no game session).
 *
 * @returns Page shell delegating to the client canvas UI.
 */
export default function SpriteViewerPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SpriteViewerClient />
    </div>
  )
}
