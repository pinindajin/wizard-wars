import { Prisma } from "@prisma/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "@/shared/types"

const prismaMock = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  chatLog: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

vi.mock("../db", () => ({
  prisma: prismaMock,
}))

import { appRouter } from "./router"
import { createTrpcContext } from "./init"

const chatStoreMock = {
  saveChatLog: vi.fn(async () => {}),
  getLatestChatLog: vi.fn(async () => null as ChatMessage[] | null),
  deleteOldLogs: vi.fn(async () => {}),
}

describe("appRouter", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret-32-chars-minimum-required")
    prismaMock.user.findFirst.mockReset()
    prismaMock.user.findUnique.mockReset()
    prismaMock.user.findUnique.mockResolvedValue(null)
    prismaMock.user.create.mockReset()
    prismaMock.user.update.mockReset()
    chatStoreMock.getLatestChatLog.mockReset()
    chatStoreMock.getLatestChatLog.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("health query returns ok", async () => {
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
    })
    const caller = appRouter.createCaller(ctx)
    await expect(caller.health()).resolves.toEqual({ status: "ok" })
  })

  it("chat.latest returns messages from chatStore", async () => {
    const msgs: ChatMessage[] = [
      {
        id: "1",
        userId: "u",
        username: "x",
        text: "hi",
        createdAt: "2020-01-01T00:00:00.000Z",
      },
    ]
    chatStoreMock.getLatestChatLog.mockResolvedValueOnce(msgs)
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
      headers: new Headers({ cookie: "ww-token=ignored" }),
    })
    const caller = appRouter.createCaller({
      ...ctx,
      user: { sub: "u1", username: "Alice" },
    })
    await expect(caller.chat.latest()).resolves.toEqual({ messages: msgs })
  })

  it("protectedProcedure verifies DB user when flag enabled", async () => {
    vi.stubEnv("VERIFY_USER_ON_PROTECTED", "true")
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: "u1", username: "Fresh" })
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
    })
    const caller = appRouter.createCaller({
      ...ctx,
      user: { sub: "u1", username: "Stale" },
    })
    await caller.chat.latest()
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { id: true, username: true },
    })
  })

  it("protectedProcedure clears cookie when flag enabled and user missing", async () => {
    vi.stubEnv("VERIFY_USER_ON_PROTECTED", "true")
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    const setCookie = vi.fn()
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
      setCookie,
    })
    const caller = appRouter.createCaller({
      ...ctx,
      user: { sub: "u1", username: "Missing" },
    })
    await expect(caller.chat.latest()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    expect(setCookie).toHaveBeenCalledWith(expect.stringContaining("Max-Age=0"))
  })

  it("auth.signup creates user when username free", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null)
    prismaMock.user.create.mockResolvedValueOnce({ id: "id1", username: "NewUser" })
    const setCookie = vi.fn()
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
      setCookie,
    })
    const caller = appRouter.createCaller(ctx)
    const out = await caller.auth.signup({ username: "NewUser", password: "password12" })
    expect(out.user.username).toBe("NewUser")
    expect(setCookie).toHaveBeenCalled()
  })

  it("auth.signup throws CONFLICT when username taken", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({ username: "Taken" })
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
    })
    const caller = appRouter.createCaller(ctx)
    await expect(
      caller.auth.signup({ username: "Taken", password: "password12" }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("auth.login succeeds with valid password", async () => {
    const bcrypt = await import("bcryptjs")
    const hash = await bcrypt.hash("password12", 10)
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Bob",
      passwordHash: hash,
    })
    const setCookie = vi.fn()
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
      setCookie,
    })
    const caller = appRouter.createCaller(ctx)
    const out = await caller.auth.login({ username: "Bob", password: "password12" })
    expect(out.user.id).toBe("u1")
    expect(setCookie).toHaveBeenCalled()
  })

  it("auth.login throws when user missing", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
    })
    const caller = appRouter.createCaller(ctx)
    await expect(caller.auth.login({ username: "nope", password: "password12" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
  })

  it("auth.login throws when password wrong", async () => {
    const bcrypt = await import("bcryptjs")
    const hash = await bcrypt.hash("rightpass", 10)
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Bob",
      passwordHash: hash,
    })
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
    })
    const caller = appRouter.createCaller(ctx)
    await expect(caller.auth.login({ username: "Bob", password: "wrongpass1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
  })

  it("user.me requires auth", async () => {
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
    })
    const caller = appRouter.createCaller({ ...ctx, user: null })
    await expect(caller.user.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
  })

  it("user.me returns prisma user", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      username: "Bob",
      combatNumbersMode: "OFF",
      bgmVolume: 50,
      sfxVolume: 60,
      openSettingsKey: "\\",
      minimapCorner: "bottom_right",
    })
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
    })
    const caller = appRouter.createCaller({ ...ctx, user: { sub: "u1", username: "Bob" } })
    const out = await caller.user.me()
    expect(out.user?.username).toBe("Bob")
    expect(out.user?.minimapCorner).toBe("bottom_right")
  })

  it("user.updateSettings updates user", async () => {
    prismaMock.user.update.mockResolvedValueOnce({
      id: "u1",
      combatNumbersMode: "ON",
      bgmVolume: 10,
      sfxVolume: 20,
      openSettingsKey: "Tab",
      minimapCorner: "top_left",
    })
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
    })
    const caller = appRouter.createCaller({ ...ctx, user: { sub: "u1", username: "Bob" } })
    const out = await caller.user.updateSettings({
      bgmVolume: 10,
      minimapCorner: "bottom_right",
    })
    expect(out.user.bgmVolume).toBe(10)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bgmVolume: 10, minimapCorner: "bottom_right" }),
      }),
    )
  })

  it("user.updateSettings clears stale sessions on missing user update", async () => {
    prismaMock.user.update.mockRejectedValueOnce({ code: "P2025" })
    const setCookie = vi.fn()
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
      setCookie,
    })
    const caller = appRouter.createCaller({ ...ctx, user: { sub: "u1", username: "Bob" } })
    await expect(caller.user.updateSettings({ bgmVolume: 10 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
    expect(setCookie).toHaveBeenCalledWith(expect.stringContaining("Max-Age=0"))
  })

  it("user.updateSettings clears stale sessions on Prisma P2025 client error", async () => {
    const prismaErr = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "test",
    })
    prismaMock.user.update.mockRejectedValueOnce(prismaErr)
    const setCookie = vi.fn()
    const ctx = await createTrpcContext({
      prismaClient: prismaMock as never,
      chatStore: chatStoreMock,
      setCookie,
    })
    const caller = appRouter.createCaller({ ...ctx, user: { sub: "u1", username: "Bob" } })
    await expect(caller.user.updateSettings({ bgmVolume: 10 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
    expect(setCookie).toHaveBeenCalledWith(expect.stringContaining("Max-Age=0"))
  })
})
