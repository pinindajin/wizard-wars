import "dotenv/config"
import { prisma } from "@/server/db"

/**
 * Integration test setup: connect to the test DB before all tests.
 */
beforeAll(async () => {
  // Verify DB connectivity
  await prisma.$queryRaw`SELECT 1`
})

afterAll(async () => {
  await prisma.$disconnect()
})
