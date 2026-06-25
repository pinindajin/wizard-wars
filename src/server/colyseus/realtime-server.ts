import { createServer, type Server as HttpServer } from "node:http"
import { pathToFileURL } from "node:url"
import express, { type Express } from "express"
import * as colyseusCore from "@colyseus/core"

import { createColyseusServer } from "./app.config"
import { createRealtimeAdminRouter } from "./realtimeAdminRoutes"
import { createPostgresChatStore } from "../store/postgres"
import { prisma } from "../db"
import { applyDbLogLevelOverride, logger, resolveEnvLogLevel } from "../logger"

/**
 * Installs lightweight CORS headers for browser-facing realtime HTTP requests.
 *
 * @param app - Express application.
 * @param allowedOrigin - Optional allowed web origin.
 */
export function installRealtimeCors(app: Express, allowedOrigin = process.env.WW_WEB_ORIGIN?.trim()): void {
  app.use((req, res, next) => {
    const origin = req.header("origin")
    if (allowedOrigin && origin === allowedOrigin) {
      res.header("access-control-allow-origin", allowedOrigin)
      res.header("access-control-allow-credentials", "true")
      res.header("access-control-allow-headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization")
      res.header("access-control-allow-methods", "GET,HEAD,POST,OPTIONS")
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204)
      return
    }
    next()
  })
}

/**
 * Creates the HTTP app used by the realtime process.
 *
 * @returns Express app with realtime health/readiness and internal admin routes.
 */
export function createRealtimeHttpApp(): Express {
  const app = express()
  installRealtimeCors(app)
  app.use(express.json({ limit: "32kb" }))
  app.use(
    createRealtimeAdminRouter({
      adminToken: process.env.WW_REALTIME_ADMIN_TOKEN,
    }),
  )
  return app
}

/**
 * Boots the standalone Colyseus realtime process.
 */
export async function bootstrapRealtimeServer(): Promise<void> {
  logger.info(
    {
      event: "app.starting",
      role: "realtime",
      env: process.env.NODE_ENV ?? "development",
    },
    "Starting Wizard Wars realtime server",
  )
  logger.info(
    {
      event: "log.level.resolved",
      role: "realtime",
      source: process.env.LOG_LEVEL?.trim() ? "env" : "default",
      level: resolveEnvLogLevel(),
    },
    "Initial log level resolved",
  )

  if (!process.env.AUTH_SECRET?.trim()) {
    logger.fatal(
      { event: "app.config.missing", role: "realtime", key: "AUTH_SECRET" },
      "AUTH_SECRET must be set in the environment",
    )
    process.exit(1)
  }

  await applyDbLogLevelOverride(prisma)

  const app = createRealtimeHttpApp()
  const httpServer: HttpServer = createServer(app)
  const chatStore = createPostgresChatStore(prisma)
  const gameServer = createColyseusServer(httpServer, chatStore)
  ;(globalThis as unknown as { __wizardWarsMatchMaker: typeof colyseusCore.matchMaker }).__wizardWarsMatchMaker =
    colyseusCore.matchMaker

  const port = Number(process.env.PORT ?? "3001")
  await gameServer.listen(port, "0.0.0.0")
  logger.info({ event: "app.ready", role: "realtime", port }, "Wizard Wars realtime server ready")
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (invokedPath === import.meta.url) {
  bootstrapRealtimeServer().catch((err: unknown) => {
    logger.fatal({ event: "app.start.failed", role: "realtime", err }, "Realtime server failed to start")
    process.exit(1)
  })
}
