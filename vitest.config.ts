import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/app/**/*.tsx",
        "src/game/**",
        "src/shared/balance-config/generated/**",
        "src/lib/trpc.ts",
        "src/server/db/index.ts",
        "src/**/*.test.{ts,tsx}",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 85,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
