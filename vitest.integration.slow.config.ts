import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.slow.test.ts"],
    setupFiles: ["./tests/integration/vitest-setup-slow.ts"],
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
