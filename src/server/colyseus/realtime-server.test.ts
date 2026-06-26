import { createServer, type Server as HttpServer } from "node:http"
import express from "express"
import { afterEach, describe, expect, it } from "vitest"

import { installRealtimeCors } from "./realtime-server"

type StartedServer = {
  readonly server: HttpServer
  readonly baseUrl: string
}

/**
 * Starts a small Express server with realtime CORS middleware installed.
 *
 * @param allowedOrigin - Origin string passed to the realtime CORS middleware.
 * @returns Bound test server and base URL.
 */
async function startCorsServer(allowedOrigin: string): Promise<StartedServer> {
  const app = express()
  installRealtimeCors(app, allowedOrigin)
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind to a TCP port")
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

describe("realtime CORS", () => {
  let started: StartedServer | null = null

  afterEach(async () => {
    if (!started) return
    await new Promise<void>((resolve) => started?.server.close(() => resolve()))
    started = null
  })

  it("allows both loopback hostnames for local compose origins", async () => {
    started = await startCorsServer("http://127.0.0.1:3000,http://localhost:3000")

    const localhost = await fetch(`${started.baseUrl}/healthz`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000" },
    })
    const loopbackAddress = await fetch(`${started.baseUrl}/healthz`, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:3000" },
    })

    expect(localhost.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    expect(loopbackAddress.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3000")
  })
})
