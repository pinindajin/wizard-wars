import "dotenv/config"
import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/vitest-setup-env.ts"],
    testTimeout: 120000,
    hookTimeout: 20000,
    teardownTimeout: 3000,
    fileParallelism: false,
    pool: "threads",
    poolOptions: {
      threads: { singleThread: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
