import type { Prisma, PrismaClient } from "@prisma/client"

import type { ChatMessage } from "../../shared/types"
import type { ChatStore } from "./types"

/**
 * Parses a JSON value from the DB into a typed ChatMessage array, returning null on shape mismatch.
 *
 * @param value - Raw JSON from Prisma (unknown type).
 * @returns Array of ChatMessage or null if the shape is invalid.
 */
const parseMessages = (value: unknown): ChatMessage[] | null => {
  if (!Array.isArray(value)) {
    return null
  }
  return value.filter((item): item is ChatMessage => {
    if (!item || typeof item !== "object") {
      return false
    }
    const typed = item as Partial<ChatMessage>
    return (
      typeof typed.id === "string" &&
      typeof typed.userId === "string" &&
      typeof typed.username === "string" &&
      typeof typed.text === "string" &&
      typeof typed.createdAt === "string"
    )
  })
}

/**
 * Creates a Postgres-backed ChatStore that persists buffered messages on a timer.
 * Retains only the most recent log row; older rows are deleted on each save.
 *
 * @param prisma - Prisma client instance.
 * @returns ChatStore implementation backed by Postgres.
 */
export const createPostgresChatStore = (prisma: PrismaClient): ChatStore => {
  return {
    saveChatLog: async (messages) => {
      await prisma.chatLog.create({
        data: {
          messages: messages as unknown as Prisma.InputJsonValue,
        },
      })
    },
    getLatestChatLog: async () => {
      const latest = await prisma.chatLog.findFirst({
        orderBy: { savedAt: "desc" },
      })
      if (!latest) {
        return null
      }
      return parseMessages(latest.messages)
    },
    deleteOldLogs: async () => {
      const oldLogs = await prisma.chatLog.findMany({
        orderBy: { savedAt: "desc" },
        select: { id: true },
        skip: 1,
      })
      if (oldLogs.length === 0) {
        return
      }
      await prisma.chatLog.deleteMany({
        where: { id: { in: oldLogs.map((log) => log.id) } },
      })
    },
  }
}
