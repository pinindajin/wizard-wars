/**
 * Scoped PR-change coverage.
 * Enforces 100% lines/branches/functions/statements on the focused modules touched by
 * the active feature work. Large React/Next visual surfaces stay covered by browser/manual QA.
 */
import path from "node:path"

import { defineConfig } from "vitest/config"

const PR_CHANGE_COVERAGE_INCLUDE = [
  "scripts/animation-sync.ts",
  "scripts/check-animation-config.ts",
  "src/app/api/dev/animation-tool/save/route.ts",
  "src/game/animation/LadyWizardAnimDefs.ts",
  "src/shared/balance-config/animationConfig.ts",
  "src/shared/balance-config/equipment.ts",
  "src/shared/balance-config/heroes.ts",
  "src/shared/balance-config/items.ts",
  "src/shared/events.ts",
  "src/shared/roomEvents.ts",
  "src/shared/validators.ts",
  "src/shared/playerAnimAim.ts",
  "src/shared/sprites/spriteViewerOverlays.ts",
  "src/server/gameserver/sessionShop.ts",
  "src/server/game/components.ts",
  "src/server/game/systems/primaryMeleeAttackSystem.ts",
  "src/server/game/systems/swingConeGeometry.ts",
  "src/game/ecs/systems/PrimaryMeleeAttackRenderSystem.ts",
  "src/lib/kill-feed-format.ts",
] as const

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      all: true,
      include: [...PR_CHANGE_COVERAGE_INCLUDE],
      exclude: ["**/*.test.{ts,tsx}", "**/node_modules/**"],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
