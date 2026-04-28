/**
 * Scoped coverage for hero primary melee + shop weapon removal.
 * Enforces 100% lines/branches/functions/statements on these modules only.
 * (Large surfaces like `GameLobbyRoom` / `ArenaRuntime` stay covered via integration / E2E.)
 */
import path from "node:path"

import { defineConfig } from "vitest/config"

const HERO_PRIMARY_MELEE_COVERAGE_INCLUDE = [
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
      include: [...HERO_PRIMARY_MELEE_COVERAGE_INCLUDE],
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
