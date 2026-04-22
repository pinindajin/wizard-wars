import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.fast.test.ts"],
    setupFiles: ["./tests/integration/vitest-setup-fast.ts"],
    testTimeout: 30000,
    hookTimeout: 10000,
    teardownTimeout: 3000,
    fileParallelism: false,
    pool: "threads",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
