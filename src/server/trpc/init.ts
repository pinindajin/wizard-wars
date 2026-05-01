import { TRPCError, initTRPC } from "@trpc/server"
import type { PrismaClient } from "@prisma/client"
import superjson from "superjson"

import { prisma } from "../db"
import {
  AUTH_COOKIE_NAME,
  createClearAuthCookie,
  findExistingAuthUser,
  shouldVerifyUserOnProtected,
  verifyToken,
} from "../auth"
import { createPostgresChatStore } from "../store/postgres"
import type { ChatStore } from "../store/types"
import type { AuthUser } from "../../shared/types"

/**
 * tRPC server bootstrap: shared context (Prisma, optional user from Cookie header, chat store, optional setCookie),
 * SuperJSON transformer, and publicProcedure / protectedProcedure middleware.
 */

type CreateContextOptions = {
  readonly headers?: Headers
  readonly prismaClient?: PrismaClient
  readonly chatStore?: ChatStore
  readonly setCookie?: (cookieValue: string) => void
}

/** Per-request context passed to all tRPC procedures. */
export type TrpcContext = {
  readonly prisma: PrismaClient
  readonly user: AuthUser | null
  readonly chatStore: ChatStore
  readonly setCookie?: (cookieValue: string) => void
}

/**
 * Parses a Cookie header string into a flat key/value map.
 *
 * @param cookieHeader - Raw Cookie header value.
 * @returns Record mapping cookie names to their values.
 */
const parseCookieHeader = (cookieHeader: string): Record<string, string> => {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const [key, ...valueParts] = part.split("=")
      if (!key || valueParts.length === 0) {
        return acc
      }
      acc[key] = valueParts.join("=")
      return acc
    }, {})
}

/**
 * Resolves the current user from optional Fetch API Headers by reading the auth cookie and verifying the JWT.
 *
 * @param headers - Request headers from the tRPC caller; if omitted, returns null.
 * @returns AuthUser or null if no cookie or bad token (fail-open for anonymous).
 */
const getUserFromHeaders = async (headers?: Headers): Promise<AuthUser | null> => {
  if (!headers) {
    return null
  }
  const cookies = parseCookieHeader(headers.get("cookie") ?? "")
  const token = cookies[AUTH_COOKIE_NAME]
  if (!token) {
    return null
  }
  try {
    return await verifyToken(token)
  } catch {
    return null
  }
}

/**
 * Builds the tRPC context for a single request.
 *
 * @param options - Optional headers, prismaClient, chatStore, setCookie (defaults: app singletons).
 * @returns Promise of TrpcContext with user populated from cookies when present.
 */
export const createTrpcContext = async (options: CreateContextOptions = {}): Promise<TrpcContext> => {
  const prismaClient = options.prismaClient ?? prisma
  return {
    prisma: prismaClient,
    user: await getUserFromHeaders(options.headers),
    chatStore: options.chatStore ?? createPostgresChatStore(prismaClient),
    setCookie: options.setCookie,
  }
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
})

export const createTrpcCallerFactory = t.createCallerFactory
export const router = t.router
export const publicProcedure = t.procedure

/**
 * Procedure that requires ctx.user; narrows context so ctx.user is non-null in the handler.
 * Throws TRPCError UNAUTHORIZED if the session cookie is missing or invalid.
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    })
  }
  if (shouldVerifyUserOnProtected()) {
    const user = await findExistingAuthUser(ctx.prisma, ctx.user)
    if (!user) {
      ctx.setCookie?.(createClearAuthCookie())
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Session expired. Please log in again.",
      })
    }
    return next({ ctx: { ...ctx, user } })
  }
  return next({ ctx: { ...ctx, user: ctx.user } })
})
