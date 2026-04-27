import { describe, expect, it, vi } from "vitest"

vi.mock("@/server/db", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    chatLog: {
      create: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
  },
}))

import { GET } from "./[trpc]/route"

describe("tRPC fetch handler", () => {
  it("responds to health query", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    const url =
      "http://localhost/api/trpc/health?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%7D%7D%7D"
    const req = new Request(url, { method: "GET" })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain("ok")
    vi.unstubAllEnvs()
  })
})
