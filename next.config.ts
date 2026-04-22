import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["@colyseus/core", "@prisma/client"],
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
