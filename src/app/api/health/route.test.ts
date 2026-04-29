import { describe, expect, it, vi } from "vitest"

vi.mock("@/server/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from "@/server/db"

import { GET } from "./route"

describe("GET /api/health", () => {
  it("returns ok when database query succeeds", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ "?column?": 1 }])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, database: "up" })
  })

  it("returns 503 when database fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("db down"))
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.database).toBe("down")
  })
})
