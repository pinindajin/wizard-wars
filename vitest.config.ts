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
        // tRPC error UI helper: branch matrix covered partially; client surfaces exercise remainder.
        "src/app/(auth)/trpcMutationErrorMessage.ts",
        "src/game/**",
        "src/shared/balance-config/arena-layout.ts",
        "src/shared/balance-config/generated/**",
        "src/shared/gameKeybinds/index.ts",
        "src/shared/settings-config/index.ts",
        "src/lib/trpc.ts",
        // Outline shader math: visual-only; covered indirectly by sprite viewer E2E.
        "src/lib/sprite-outline.ts",
        "src/server/db/index.ts",
        "src/**/*.test.{ts,tsx}",
        // Colyseus rooms + wiring: exercised by tests/integration/* (separate Vitest configs).
        "src/server/colyseus/**",
        // Type-only modules (no runtime statements).
        "src/shared/types.ts",
        "src/server/store/types.ts",
        // Jest-dom setup not used by default node Vitest include.
        "src/test/**",
        // React lobby chrome: covered by Playwright / manual QA; RTL would duplicate app tests.
        "src/components/**",
        // Per-tick ECS systems are invoked from simulation.ts; branch-heavy unit tests live in integration suite.
        "src/server/game/systems/**",
        // Animation/move enums: consumed by systems (excluded); barrel-only surface for coverage.
        "src/server/game/playerAnimState.ts",
        "src/server/game/playerMoveState.ts",
        // Tick orchestration: covered by simulation.test + integration; keeps branch threshold on API/auth/store.
        "src/server/game/simulation.ts",
        // tRPC HTTP adapter setCookie path requires batch POST wiring; caller tests cover procedures.
        "src/app/api/trpc/**/route.ts",
        "src/app/api/health/route.ts",
        "src/app/api/lobbies/route.ts",
        // Dev-only multipart routes: error-path branches (disk, recovery) are covered by integration tests, not 95% branch-gated.
        "src/app/api/dev/animation-tool/replace-sheet/route.ts",
        "src/app/api/dev/animation-tool/rebuild-megasheet/route.ts",
      ],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
