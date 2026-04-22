import { describe, expect, it } from "vitest"

import { prisma } from "@/server/db"

/**
 * Slow integration smoke test: verifies Postgres is reachable and migrations ran.
 * The vitest-setup-slow.ts already executes SELECT 1 in beforeAll; this test
 * adds a named assertion and a NOW() round-trip to make the proof explicit.
 */
describe("slow integration smoke — Prisma round-trip", () => {
  it("SELECT 1 returns the expected value", async () => {
    const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`
    expect(result).toEqual([{ ok: 1 }])
  })

  it("SELECT NOW() returns a Date", async () => {
    const result = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`
    expect(result[0]?.now).toBeInstanceOf(Date)
  })

  it("users table exists and is accessible (migrations ran)", async () => {
    const count = await prisma.user.count()
    expect(typeof count).toBe("number")
  })
})
