import { loadEnvConfig } from "@next/env"
import { config as loadDotenv } from "dotenv"
import path from "node:path"
import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let cached: PrismaClient | undefined

/**
 * Loads .env and Next.js env config on first access (fixes Turbopack inlining env at bundle time).
 */
function ensureEnvLoaded(): void {
  loadDotenv({ path: path.join(process.cwd(), ".env") })
  const isDev = process.env.NODE_ENV !== "production"
  loadEnvConfig(process.cwd(), isDev, undefined, true)
}

/**
 * Creates a new PrismaClient instance using the resolved DATABASE_URL.
 * Falls back to a placeholder URL in Vitest to prevent accidental real DB connections.
 */
function createClient(): PrismaClient {
  ensureEnvLoaded()

  const vitestPlaceholder =
    process.env.VITEST === "true"
      ? "postgresql://127.0.0.1:65534/__vitest_placeholder__"
      : undefined

  const databaseUrl = process.env.DATABASE_URL?.trim() || vitestPlaceholder

  if (databaseUrl) {
    return new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    })
  }

  return new PrismaClient()
}

/**
 * Returns the global Prisma singleton (creates it on first access).
 * In development, attaches to globalThis to survive hot-reload without creating multiple instances.
 */
function getSingleton(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma
  }
  if (!cached) {
    cached = createClient()
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = cached
    }
  }
  return cached
}

/**
 * Lazy singleton Prisma client proxy.
 * All property accesses are forwarded to the real PrismaClient initialized on first use.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getSingleton()
    const value = Reflect.get(client, prop as string | symbol, client)
    if (typeof value === "function") {
      return value.bind(client)
    }
    return value
  },
}) as PrismaClient
