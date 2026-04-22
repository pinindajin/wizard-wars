import "dotenv/config"

import { prisma } from "@/server/db"

/**
 * Vitest setup for the slow integration tier.
 * Verifies a real Postgres connection is available before any test runs,
 * and disconnects the Prisma client cleanly after the suite finishes.
 */
beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`
})

afterAll(async () => {
  await prisma.$disconnect()
})
