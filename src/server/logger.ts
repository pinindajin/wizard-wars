import pino from "pino"
import type { PrismaClient } from "@prisma/client"
import { config as loadDotenv } from "dotenv"

import {
  DEFAULT_SERVER_LOG_LEVEL,
  parseServerLogLevel,
  type ServerLogLevel as ServerLogLevelType,
} from "@/shared/logging/levels"

loadDotenv({ quiet: true })

export const APP_CONFIG_ID = "global"

export function resolveEnvLogLevel(envValue = process.env.LOG_LEVEL): ServerLogLevelType {
  return parseServerLogLevel(envValue) ?? DEFAULT_SERVER_LOG_LEVEL
}

/**
 * Application-wide structured logger (pino). Uses pretty-print in development and
 * compact JSON in production for Render's log aggregation UI.
 */
export const logger = pino({
  level: resolveEnvLogLevel(),
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
})

export function setRuntimeLogLevel(dbOverride: ServerLogLevelType | null): ServerLogLevelType {
  const nextLevel = dbOverride ?? resolveEnvLogLevel()
  logger.level = nextLevel
  return nextLevel
}

export type DbLogLevelOverrideResult =
  | { status: "missing"; effectiveLevel: ServerLogLevelType }
  | { status: "none"; effectiveLevel: ServerLogLevelType }
  | { status: "applied"; overrideLevel: ServerLogLevelType; effectiveLevel: ServerLogLevelType }
  | { status: "invalid"; value: string; effectiveLevel: ServerLogLevelType }
  | { status: "failed"; err: unknown; effectiveLevel: ServerLogLevelType }

export async function applyDbLogLevelOverride(prisma: PrismaClient): Promise<DbLogLevelOverrideResult> {
  try {
    const row = await prisma.appConfig.findUnique({
      where: { id: APP_CONFIG_ID },
      select: { logLevel: true },
    })
    if (!row) {
      const effectiveLevel = setRuntimeLogLevel(null)
      logger.debug(
        { event: "log.level.db_override.missing", level: effectiveLevel },
        "No DB log level override row found",
      )
      return { status: "missing", effectiveLevel }
    }
    if (row.logLevel === null) {
      const effectiveLevel = setRuntimeLogLevel(null)
      logger.info(
        { event: "log.level.db_override.none", level: effectiveLevel },
        "DB log level override is disabled",
      )
      return { status: "none", effectiveLevel }
    }

    const parsed = parseServerLogLevel(row.logLevel)
    if (!parsed) {
      const effectiveLevel = setRuntimeLogLevel(null)
      logger.warn(
        {
          event: "log.level.db_override.invalid",
          value: row.logLevel,
          fallbackLevel: effectiveLevel,
        },
        "Invalid DB log level override ignored",
      )
      return { status: "invalid", value: row.logLevel, effectiveLevel }
    }

    const effectiveLevel = setRuntimeLogLevel(parsed)
    logger.info(
      { event: "log.level.db_override.applied", level: effectiveLevel },
      "DB log level override applied",
    )
    return { status: "applied", overrideLevel: parsed, effectiveLevel }
  } catch (err) {
    const effectiveLevel = setRuntimeLogLevel(null)
    logger.warn(
      { event: "log.level.db_override.failed", err, fallbackLevel: effectiveLevel },
      "Failed to load DB log level override",
    )
    return { status: "failed", err, effectiveLevel }
  }
}
