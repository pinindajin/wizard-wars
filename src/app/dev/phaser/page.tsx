import type { Metadata } from "next"

import DevPhaserClient from "./DevPhaserClient"

export const metadata: Metadata = {
  title: "Wizard Wars - Phaser Dev",
}

/**
 * Phaser Editor dev route: mounts the Phaser game directly so Phaser Editor v5
 * can connect via `playUrl`.
 */
export default function DevPhaserPage() {
  return <DevPhaserClient />
}
