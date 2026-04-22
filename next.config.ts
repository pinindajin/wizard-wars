import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["@colyseus/core", "@prisma/client"],
  turbopack: {
    root: __dirname,
    // Turbopack prefers the "module" field (phaser.esm.js) which has no
    // export default, breaking strict ESM validation. Force the UMD build
    // which exports via module.exports and gets a synthetic default.
    resolveAlias: {
      phaser: "./node_modules/phaser/dist/phaser.js",
    },
  },
}

export default nextConfig
