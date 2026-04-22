/**
 * Phaser Editor dev route: serves a minimal HTML page that mounts the Phaser game
 * directly (no React wrapper) so Phaser Editor v5 can connect via `playUrl`.
 */
export default function DevPhaserPage() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Wizard Wars — Phaser Dev</title>
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { background: #1a1a2e; overflow: hidden; }
          #phaser-dev-container { width: 100vw; height: 100vh; }
        `}</style>
      </head>
      <body>
        <div id="phaser-dev-container" />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/dev-phaser-bootstrap.js" />
      </body>
    </html>
  )
}
