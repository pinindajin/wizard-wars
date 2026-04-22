import { createServer } from "node:http"
import type { Duplex } from "node:stream"
import { parse } from "node:url"
import * as colyseusCore from "@colyseus/core"
import next from "next"
import express from "express"

import { createColyseusServer, getColyseusWss } from "./src/server/colyseus/app.config"
import { createPostgresChatStore } from "./src/server/store/postgres"
import { prisma } from "./src/server/db"
import { logger } from "./src/server/logger"

const dev = process.env.NODE_ENV !== "production"
const nextApp = next({ dev })
const handle = nextApp.getRequestHandler()

/**
 * Application bootstrap: prepares Next.js, creates Express/Colyseus co-hosted HTTP server,
 * and wires the WebSocket upgrade router to separate Colyseus and Turbopack HMR upgrades.
 */
const bootstrap = async (): Promise<void> => {
  if (!process.env.AUTH_SECRET?.trim()) {
    console.error("FATAL: AUTH_SECRET must be set in the environment.")
    process.exit(1)
  }

  await nextApp.prepare()

  const expressApp = express()
  expressApp.use((req, res) => {
    handle(req, res, parse(req.url ?? "/", true))
  })

  const httpServer = createServer(expressApp)

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
        logger.error({ err }, "[next upgrade] failed")
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
  logger.info(`> Ready on http://localhost:${port}`)
}

void bootstrap()
