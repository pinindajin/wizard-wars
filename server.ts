import { createServer, type Server as HttpServer } from "node:http"
import type { Duplex } from "node:stream"
import { parse } from "node:url"
import * as colyseusCore from "@colyseus/core"
import next from "next"
import express, { type Express } from "express"

import { createColyseusServer, getColyseusWss } from "./src/server/colyseus/app.config"
import { createPostgresChatStore } from "./src/server/store/postgres"
import { prisma } from "./src/server/db"
import { applyDbLogLevelOverride, logger, resolveEnvLogLevel } from "./src/server/logger"
import {
  installRealtimeHttpProxy,
  isRealtimeWebSocketProxyPath,
  proxyRealtimeWebSocketUpgrade,
  resolveRealtimeProxyConfig,
  type RealtimeProxyConfig,
} from "./src/server/realtime/realtimeProxy"
import { resolveServerMode, type ServerMode } from "./src/server/runtimeConfig"

const dev = process.env.NODE_ENV !== "production"

/**
 * Validates process-wide auth configuration.
 *
 * @param role - Runtime process role for logs.
 */
function assertAuthSecret(role: ServerMode): void {
  if (!process.env.AUTH_SECRET?.trim()) {
    logger.fatal(
      { event: "app.config.missing", role, key: "AUTH_SECRET" },
      "AUTH_SECRET must be set in the environment",
    )
    process.exit(1)
  }
}

/**
 * Logs common startup metadata.
 *
 * @param role - Runtime process role.
 */
function logStartup(role: ServerMode): void {
  logger.info(
    { event: "app.starting", role, env: process.env.NODE_ENV ?? "development" },
    "Starting Wizard Wars server",
  )
  logger.info(
    {
      event: "log.level.resolved",
      role,
      source: process.env.LOG_LEVEL?.trim() ? "env" : "default",
      level: resolveEnvLogLevel(),
    },
    "Initial log level resolved",
  )
}

/**
 * Creates the Next/Express app used by web and single-process modes.
 *
 * @returns Prepared Next app, Express app, and HTTP server.
 */
async function createWebHttpServer(options: {
  readonly realtimeProxy?: RealtimeProxyConfig | null
} = {}): Promise<{
  readonly nextApp: ReturnType<typeof next>
  readonly expressApp: Express
  readonly httpServer: HttpServer
}> {
  const nextApp = next({ dev })
  const handle = nextApp.getRequestHandler()

  await nextApp.prepare()

  const expressApp = express()
  if (options.realtimeProxy) {
    installRealtimeHttpProxy(expressApp, options.realtimeProxy)
  }
  expressApp.use((req, res) => {
    handle(req, res, parse(req.url ?? "/", true))
  })

  return {
    nextApp,
    expressApp,
    httpServer: createServer(expressApp),
  }
}

/**
 * Starts a plain HTTP server and resolves once it is listening.
 *
 * @param httpServer - HTTP server.
 * @param port - Port to bind.
 */
async function listenHttpServer(httpServer: HttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve) => {
    httpServer.listen(port, "0.0.0.0", resolve)
  })
}

/**
 * Boots the web-only process. Realtime clients connect to `NEXT_PUBLIC_COLYSEUS_URL`.
 */
async function bootstrapWebOnly(): Promise<void> {
  const role: ServerMode = "web"
  logStartup(role)
  assertAuthSecret(role)
  await applyDbLogLevelOverride(prisma)

  const realtimeProxy = resolveRealtimeProxyConfig()
  const { nextApp, httpServer } = await createWebHttpServer({ realtimeProxy })
  const nextUpgradeHandler = dev ? nextApp.getUpgradeHandler() : null
  if ((dev && nextUpgradeHandler) || realtimeProxy) {
    httpServer.on("upgrade", (req, socket, head) => {
      const pathname = req.url?.split("?")[0] ?? "/"
      if (dev && nextUpgradeHandler && pathname.startsWith("/_next/")) {
        nextUpgradeHandler(req, socket as Duplex, head as Buffer).catch((err: unknown) => {
          logger.error({ event: "ws.upgrade.failed", role, area: "web", side: "server", err }, "WebSocket upgrade failed")
          socket.destroy()
        })
        return
      }
      if (realtimeProxy && isRealtimeWebSocketProxyPath(req.url)) {
        proxyRealtimeWebSocketUpgrade(req, socket as Duplex, head as Buffer, realtimeProxy)
        return
      }
      socket.destroy()
    })
  }

  const port = Number(process.env.PORT ?? "3000")
  await listenHttpServer(httpServer, port)
  logger.info({ event: "app.ready", role, port }, "Wizard Wars web server ready")
}

/**
 * Boots the legacy local fallback: Next and Colyseus on one HTTP server.
 */
async function bootstrapSingleProcess(): Promise<void> {
  const role: ServerMode = "single"
  logStartup(role)
  assertAuthSecret(role)
  await applyDbLogLevelOverride(prisma)

  const { nextApp, httpServer } = await createWebHttpServer()
  const chatStore = createPostgresChatStore(prisma)
  const gameServer = createColyseusServer(httpServer, chatStore)
  const colyseusWss = getColyseusWss(gameServer)

  const wssInternal = colyseusWss as unknown as { _removeListeners?: () => void }
  wssInternal._removeListeners?.()

  const nextUpgradeHandler = dev ? nextApp.getUpgradeHandler() : null

  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = req.url?.split("?")[0] ?? "/"
    if (dev && nextUpgradeHandler && pathname.startsWith("/_next/")) {
      nextUpgradeHandler(req, socket as Duplex, head as Buffer).catch((err: unknown) => {
        logger.error({ event: "ws.upgrade.failed", role, area: "netcode", side: "server", err }, "WebSocket upgrade failed")
        socket.destroy()
      })
    } else {
      colyseusWss.handleUpgrade(req, socket, head, (ws) => {
        colyseusWss.emit("connection", ws, req)
      })
    }
  })

  const port = Number(process.env.PORT ?? "3000")
  await gameServer.listen(port, "0.0.0.0")
  ;(globalThis as unknown as { __wizardWarsMatchMaker: typeof colyseusCore.matchMaker }).__wizardWarsMatchMaker =
    colyseusCore.matchMaker
  logger.info({ event: "app.ready", role, port }, "Wizard Wars server ready")
}

/**
 * Application bootstrap: chooses single-process or web-only runtime mode.
 */
const bootstrap = async (): Promise<void> => {
  const mode = resolveServerMode()
  if (mode === "realtime") {
    const { bootstrapRealtimeServer } = await import("./src/server/colyseus/realtime-server")
    await bootstrapRealtimeServer()
    return
  }
  if (mode === "web") {
    await bootstrapWebOnly()
    return
  }
  await bootstrapSingleProcess()
}

void bootstrap()
