import { describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "@/shared/types"

import { createPostgresChatStore } from "./postgres"

describe("createPostgresChatStore", () => {
  it("saveChatLog creates row", async () => {
    const create = vi.fn().mockResolvedValue({})
    const prisma = { chatLog: { create } } as never
    const store = createPostgresChatStore(prisma)
    const msgs: ChatMessage[] = [
      {
        id: "1",
        userId: "u",
        username: "x",
        text: "hi",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]
    await store.saveChatLog(msgs)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ messages: msgs }),
      }),
    )
  })

  it("getLatestChatLog returns null when no row", async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    const prisma = { chatLog: { findFirst } } as never
    const store = createPostgresChatStore(prisma)
    await expect(store.getLatestChatLog()).resolves.toBeNull()
  })

  it("getLatestChatLog parses valid json", async () => {
    const msgs: ChatMessage[] = [
      {
        id: "1",
        userId: "u",
        username: "x",
        text: "hi",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]
    const findFirst = vi.fn().mockResolvedValue({ messages: msgs })
    const prisma = { chatLog: { findFirst } } as never
    const store = createPostgresChatStore(prisma)
    await expect(store.getLatestChatLog()).resolves.toEqual(msgs)
  })

  it("getLatestChatLog returns null on malformed messages", async () => {
    const findFirst = vi.fn().mockResolvedValue({ messages: "not-array" })
    const prisma = { chatLog: { findFirst } } as never
    const store = createPostgresChatStore(prisma)
    await expect(store.getLatestChatLog()).resolves.toBeNull()
  })

  it("deleteOldLogs no-ops when only one or zero rows", async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const deleteMany = vi.fn()
    const prisma = { chatLog: { findMany, deleteMany } } as never
    const store = createPostgresChatStore(prisma)
    await store.deleteOldLogs()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it("deleteOldLogs removes older rows", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "old1" }, { id: "old2" }])
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 })
    const prisma = { chatLog: { findMany, deleteMany } } as never
    const store = createPostgresChatStore(prisma)
    await store.deleteOldLogs()
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old1", "old2"] } } })
  })
})
