"use client"

import { useEffect, useState } from "react"
import type Phaser from "phaser"

/**
 * Direct Phaser mount for Phaser Editor's `playUrl`.
 */
export default function DevPhaserClient() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let game: Phaser.Game | null = null

    void import("@/game").then(
      ({ createGame }) => {
        if (cancelled) return
        game = createGame("phaser-dev-container")
      },
      (err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to start Phaser")
      },
    )

    return () => {
      cancelled = true
      game?.destroy(true)
    }
  }, [])

  return (
    <main
      style={{
        background: "#1a1a2e",
        height: "100vh",
        margin: 0,
        overflow: "hidden",
        padding: 0,
        width: "100vw",
      }}
    >
      <div
        id="phaser-dev-container"
        data-testid="phaser-dev-container"
        style={{ height: "100vh", width: "100vw" }}
      />
      {error ? (
        <pre
          data-testid="phaser-dev-error"
          style={{
            color: "#fecaca",
            inset: 16,
            position: "fixed",
            whiteSpace: "pre-wrap",
            zIndex: 1,
          }}
        >
          {error}
        </pre>
      ) : null}
    </main>
  )
}
