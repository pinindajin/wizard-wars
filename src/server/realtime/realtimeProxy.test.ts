import { execFile } from "node:child_process"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { connect } from "node:net"
import { promisify } from "node:util"
import express from "express"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"

import {
  installRealtimeHttpProxy,
  isRealtimeHttpProxyPath,
  isRealtimeWebSocketProxyPath,
  proxyRealtimeWebSocketUpgrade,
  resolveRealtimeProxyConfig,
} from "./realtimeProxy"

const servers: Array<{ close: () => Promise<void> }> = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe("realtime proxy", () => {
  it("resolves an optional internal realtime proxy URL", () => {
    expect(
      resolveRealtimeProxyConfig({
        WW_REALTIME_PROXY_URL: " http://127.0.0.1:3001/ ",
      }),
    ).toEqual({ url: "http://127.0.0.1:3001" })
    expect(resolveRealtimeProxyConfig({})).toBeNull()
    expect(() =>
      resolveRealtimeProxyConfig({ WW_REALTIME_PROXY_URL: "not a url" }),
    ).toThrow("WW_REALTIME_PROXY_URL must be a valid http(s) URL")
    expect(() =>
      resolveRealtimeProxyConfig({ WW_REALTIME_PROXY_URL: "ws://127.0.0.1:3001" }),
    ).toThrow("WW_REALTIME_PROXY_URL must use http: or https:")
  })

  it("only proxies Colyseus matchmake HTTP routes", () => {
    expect(isRealtimeHttpProxyPath(undefined)).toBe(false)
    expect(isRealtimeHttpProxyPath("/matchmake/create/game_lobby")).toBe(true)
    expect(isRealtimeHttpProxyPath("/matchmake/joinById/game_lobby")).toBe(true)
    expect(isRealtimeHttpProxyPath("/api/auth/ws-token")).toBe(false)
    expect(isRealtimeHttpProxyPath("/_next/static/chunk.js")).toBe(false)
  })

  it("only proxies Colyseus room websocket upgrades", () => {
    expect(isRealtimeWebSocketProxyPath(undefined)).toBe(false)
    expect(isRealtimeWebSocketProxyPath("/process-id/room-id?sessionId=session")).toBe(true)
    expect(isRealtimeWebSocketProxyPath("/_next/webpack-hmr")).toBe(false)
    expect(isRealtimeWebSocketProxyPath("/api/events")).toBe(false)
    expect(isRealtimeWebSocketProxyPath("/api/events?sessionId=session")).toBe(false)
    expect(isRealtimeWebSocketProxyPath("/process-id/room-id/extra?sessionId=session")).toBe(false)
    expect(
      isRealtimeWebSocketProxyPath(
        "http://attacker.invalid//process-id/room-id?sessionId=session",
      ),
    ).toBe(false)
    expect(isRealtimeWebSocketProxyPath("/process-id/room-id")).toBe(false)
    expect(isRealtimeWebSocketProxyPath("/process-id/room-id?sessionId=")).toBe(false)
  })

  it("forwards matchmake HTTP requests with sanitized boundary headers", async () => {
    const target = await listen((req, res) => {
      let body = ""
      req.on("data", (chunk) => {
        body += String(chunk)
      })
      req.on("end", () => {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify({
          method: req.method,
          url: req.url,
          body,
          headers: req.headers,
        }))
      })
    })
    const app = express()
    installRealtimeHttpProxy(app, { url: target.url })
    app.use((_req, res) => {
      res.status(404).end("web fallback")
    })
    const proxy = await listen(app)

    const response = await fetch(`${proxy.url}/matchmake/create/game_lobby`, {
      method: "POST",
      body: "payload",
      headers: {
        authorization: "Bearer public",
        cookie: "ww-token=secret",
        "content-type": "text/plain",
        "x-forwarded-for": "203.0.113.1",
        "x-real-ip": "203.0.113.2",
      },
    })

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({
      method: "POST",
      url: "/matchmake/create/game_lobby",
      body: "payload",
    })
    expect(payload.headers).toMatchObject({
      host: new URL(target.url).host,
      "content-type": "text/plain",
    })
    expect(payload.headers.authorization).toBeUndefined()
    expect(payload.headers.cookie).toBeUndefined()
    expect(payload.headers["x-forwarded-for"]).toBeUndefined()
    expect(payload.headers["x-real-ip"]).toBeUndefined()
  })

  it("keeps absolute-form matchmake requests on the configured realtime origin", async () => {
    const target = await listen((req, res) => {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({
        url: req.url,
        host: req.headers.host,
      }))
    })
    const app = express()
    installRealtimeHttpProxy(app, { url: target.url })
    app.use((_req, res) => {
      res.status(404).end("web fallback")
    })
    const proxy = await listen(app)

    const rawResponse = await rawHttpRequest(
      proxy.url,
      "http://attacker.invalid/matchmake/create/game_lobby?room=1",
    )
    const body = rawResponse.split("\r\n\r\n").at(-1) ?? ""
    const payload = JSON.parse(body)

    expect(payload).toEqual({
      url: "/matchmake/create/game_lobby?room=1",
      host: new URL(target.url).host,
    })
  })

  it("passes non-matchmake HTTP routes through to the web app", async () => {
    const target = await listen((_req, res) => {
      res.statusCode = 418
      res.end("unexpected realtime target")
    })
    const app = express()
    installRealtimeHttpProxy(app, { url: target.url })
    app.use((_req, res) => {
      res.status(404).end("web fallback")
    })
    const proxy = await listen(app)

    const response = await fetch(`${proxy.url}/api/auth/ws-token`)

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe("web fallback")
  })

  it("returns a compact 502 when the realtime HTTP target is unavailable", async () => {
    const app = express()
    installRealtimeHttpProxy(app, { url: "http://127.0.0.1:9" })
    app.use((_req, res) => {
      res.status(404).end("web fallback")
    })
    const proxy = await listen(app)

    const response = await fetch(`${proxy.url}/matchmake/create/game_lobby`, {
      method: "POST",
      body: "payload",
    })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: "Realtime proxy unavailable",
    })
  })

  it("forwards websocket upgrades to the realtime process", async () => {
    const target = await listen((_req, res) => {
      res.statusCode = 404
      res.end("http fallback")
    })
    const realtimeWss = new WebSocketServer({ noServer: true })
    target.server.on("upgrade", (req, socket, head) => {
      realtimeWss.handleUpgrade(req, socket, head, (ws) => {
        ws.send("ready")
        ws.close(1000, "done")
      })
    })
    const proxy = await listen((_req, res) => {
      res.statusCode = 404
      res.end("web fallback")
    })
    proxy.server.on("upgrade", (req, socket, head) => {
      proxyRealtimeWebSocketUpgrade(req, socket, head, { url: target.url })
    })

    await expect(readWebSocketMessages(proxy.url)).resolves.toEqual(["ready"])
    realtimeWss.close()
  })

  it("bridges websocket frames in both directions", async () => {
    const target = await listen((_req, res) => {
      res.statusCode = 404
      res.end("http fallback")
    })
    const realtimeWss = new WebSocketServer({ noServer: true })
    target.server.on("upgrade", (req, socket, head) => {
      realtimeWss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data) => {
          ws.send(`echo:${data.toString()}`)
          ws.close(1000, "done")
        })
      })
    })
    const proxy = await listen((_req, res) => {
      res.statusCode = 404
      res.end("web fallback")
    })
    proxy.server.on("upgrade", (req, socket, head) => {
      proxyRealtimeWebSocketUpgrade(req, socket, head, { url: target.url })
    })

    await expect(roundTripWebSocketMessage(proxy.url, "ping")).resolves.toEqual(["echo:ping"])
    realtimeWss.close()
  })

  it("bridges websocket upgrades when the proxy runs under Bun", async () => {
    await expect(execBunWebSocketProxyProbe()).resolves.toContain("proxied websocket ok")
  }, 10_000)

  it("closes oversized public websocket frames before they reach realtime", async () => {
    const target = await listen((_req, res) => {
      res.statusCode = 404
      res.end("http fallback")
    })
    const realtimeMessages: string[] = []
    const realtimeWss = new WebSocketServer({ noServer: true })
    target.server.on("upgrade", (req, socket, head) => {
      realtimeWss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data) => {
          realtimeMessages.push(data.toString())
        })
      })
    })
    const proxy = await listen((_req, res) => {
      res.statusCode = 404
      res.end("web fallback")
    })
    proxy.server.on("upgrade", (req, socket, head) => {
      proxyRealtimeWebSocketUpgrade(req, socket, head, { url: target.url })
    })

    await expect(sendOversizedWebSocketMessage(proxy.url)).resolves.toBe(1009)
    expect(realtimeMessages).toEqual([])
    realtimeWss.close()
  })

  it("closes realtime when the public browser socket misses proxy heartbeat pongs", async () => {
    const target = await listen((_req, res) => {
      res.statusCode = 404
      res.end("http fallback")
    })
    const realtimeCloseCodes: number[] = []
    const realtimeWss = new WebSocketServer({ noServer: true })
    target.server.on("upgrade", (req, socket, head) => {
      realtimeWss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("close", (code) => {
          realtimeCloseCodes.push(code)
        })
      })
    })
    const proxy = await listen((_req, res) => {
      res.statusCode = 404
      res.end("web fallback")
    })
    proxy.server.on("upgrade", (req, socket, head) => {
      proxyRealtimeWebSocketUpgrade(req, socket, head, { url: target.url }, {
        browserHeartbeatIntervalMs: 10,
      })
    })

    const closeCode = await missProxyHeartbeat(proxy.url)

    expect(closeCode).toBe(1001)
    await waitFor(() => realtimeCloseCodes.length > 0)
    expect(realtimeCloseCodes).toEqual([1001])
    realtimeWss.close()
  })
})

type ListeningServer = {
  readonly server: ReturnType<typeof createServer>
  readonly url: string
  close: () => Promise<void>
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<ListeningServer> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address")
  }
  const listening = {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      }),
  }
  servers.push(listening)
  return listening
}

async function readWebSocketMessages(url: string): Promise<string[]> {
  const websocketUrl = `${url.replace(/^http/, "ws")}/process-id/room-id?sessionId=session`
  return new Promise((resolve, reject) => {
    const messages: string[] = []
    const ws = new WebSocket(websocketUrl)
    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error("Timed out waiting for proxied websocket"))
    }, 3_000)

    ws.on("message", (data) => {
      messages.push(data.toString())
    })
    ws.on("close", () => {
      clearTimeout(timeout)
      resolve(messages)
    })
    ws.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function rawHttpRequest(url: string, requestTarget: string): Promise<string> {
  const target = new URL(url)
  const port = Number.parseInt(target.port, 10)
  return new Promise((resolve, reject) => {
    const socket = connect(port, target.hostname)
    let response = ""
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      if (settleTimer) clearTimeout(settleTimer)
      clearTimeout(timeout)
      socket.destroy()
      resolve(response)
    }
    const timeout = setTimeout(() => {
      settled = true
      socket.destroy()
      reject(new Error("Timed out waiting for raw HTTP response"))
    }, 3_000)

    socket.on("connect", () => {
      socket.write(
        [
          `GET ${requestTarget} HTTP/1.1`,
          "Host: public.example",
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      )
    })
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8")
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(finish, 25)
    })
    socket.on("end", finish)
    socket.on("close", () => {
      if (response.length > 0) finish()
    })
    socket.on("error", (err) => {
      settled = true
      if (settleTimer) clearTimeout(settleTimer)
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function roundTripWebSocketMessage(url: string, message: string): Promise<string[]> {
  const websocketUrl = `${url.replace(/^http/, "ws")}/process-id/room-id?sessionId=session`
  return new Promise((resolve, reject) => {
    const messages: string[] = []
    const ws = new WebSocket(websocketUrl)
    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error("Timed out waiting for proxied websocket round trip"))
    }, 3_000)

    ws.on("open", () => {
      ws.send(message)
    })
    ws.on("message", (data) => {
      messages.push(data.toString())
    })
    ws.on("close", () => {
      clearTimeout(timeout)
      resolve(messages)
    })
    ws.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function sendOversizedWebSocketMessage(url: string): Promise<number> {
  const websocketUrl = `${url.replace(/^http/, "ws")}/process-id/room-id?sessionId=session`
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(websocketUrl)
    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error("Timed out waiting for oversized websocket close"))
    }, 3_000)

    ws.on("open", () => {
      ws.send(Buffer.alloc(70 * 1024))
    })
    ws.on("close", (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
    ws.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function missProxyHeartbeat(url: string): Promise<number> {
  const websocketUrl = `${url.replace(/^http/, "ws")}/process-id/room-id?sessionId=session`
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(websocketUrl, { autoPong: false })
    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error("Timed out waiting for proxy heartbeat close"))
    }, 1_000)

    ws.on("close", (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
    ws.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error("Timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function execBunWebSocketProxyProbe(): Promise<string> {
  const { stdout } = await execFileAsync("bun", ["--eval", bunWebSocketProxyProbe], {
    cwd: process.cwd(),
    timeout: 7_000,
  })
  return stdout
}

const bunWebSocketProxyProbe = `
import { createServer } from "node:http"
import { WebSocket, WebSocketServer } from "ws"
import { proxyRealtimeWebSocketUpgrade } from "./src/server/realtime/realtimeProxy.ts"

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected TCP address")
  return {
    url: \`http://127.0.0.1:\${address.port}\`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const targetServer = createServer((_req, res) => {
  res.statusCode = 404
  res.end("target fallback")
})
const realtimeWss = new WebSocketServer({ noServer: true })
targetServer.on("upgrade", (req, socket, head) => {
  realtimeWss.handleUpgrade(req, socket, head, (ws) => {
    ws.send("ready")
    ws.close(1000, "done")
  })
})
const target = await listen(targetServer)

const proxyServer = createServer((_req, res) => {
  res.statusCode = 404
  res.end("proxy fallback")
})
proxyServer.on("upgrade", (req, socket, head) => {
  proxyRealtimeWebSocketUpgrade(req, socket, head, { url: target.url })
})
const proxy = await listen(proxyServer)

try {
  const websocketUrl = \`\${proxy.url.replace(/^http/, "ws")}/process-id/room-id?sessionId=session\`
  const messages = await new Promise((resolve, reject) => {
    const seen = []
    const ws = new WebSocket(websocketUrl)
    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error("Timed out waiting for Bun proxied websocket"))
    }, 3_000)
    ws.on("message", (data) => seen.push(data.toString()))
    ws.on("close", () => {
      clearTimeout(timeout)
      resolve(seen)
    })
    ws.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
  if (JSON.stringify(messages) !== JSON.stringify(["ready"])) {
    throw new Error(\`Unexpected messages: \${JSON.stringify(messages)}\`)
  }
  console.log("proxied websocket ok")
} finally {
  realtimeWss.close()
  proxyServer.close()
  targetServer.close()
}
process.exit(0)
`
