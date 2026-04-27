import { afterEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "@/shared/types"

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  chatLog: {},
}))

vi.mock("../db", () => ({ prisma: prismaMock }))

import { createTrpcContext } from "./init"

const chatStore = {
  saveChatLog: vi.fn(),
  getLatestChatLog: vi.fn(async () => null as ChatMessage[] | null),
  deleteOldLogs: vi.fn(),
}

describe("createTrpcContext", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("parses cookie header and resolves user", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    const { signToken } = await import("../auth")
    const token = await signToken({ sub: "u9", username: "Zed" })
    const headers = new Headers({ cookie: `ww-token=${token}; other=1` })
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore,
      headers,
    })
    expect(ctx.user?.sub).toBe("u9")
  })

  it("returns null user when cookie malformed (no value)", async () => {
    const headers = new Headers({ cookie: "ww-token" })
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore,
      headers,
    })
    expect(ctx.user).toBeNull()
  })

  it("returns null user when verify fails", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    const headers = new Headers({ cookie: "ww-token=not-a-jwt" })
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore,
      headers,
    })
    expect(ctx.user).toBeNull()
  })
})
