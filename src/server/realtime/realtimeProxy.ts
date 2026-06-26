import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
} from "node:http"
import type { Duplex } from "node:stream"
import type { Express, NextFunction, Request, Response } from "express"
import { WebSocket, WebSocketServer, type RawData } from "ws"

export type RealtimeProxyConfig = {
  readonly url: string
}

type RealtimeProxyEnv = {
  readonly WW_REALTIME_PROXY_URL?: string | undefined
  readonly [key: string]: string | undefined
}

type PendingWebSocketMessage = {
  readonly data: RawData
  readonly isBinary: boolean
}

const REALTIME_PROXY_MAX_PAYLOAD_BYTES = 64 * 1024
const REALTIME_PROXY_MAX_BUFFERED_BYTES = 1024 * 1024
const REALTIME_PROXY_BACKPRESSURE_CLOSE_CODE = 1009
const REALTIME_PROXY_BROWSER_HEARTBEAT_INTERVAL_MS = 15_000
const REALTIME_PROXY_BROWSER_HEARTBEAT_CLOSE_CODE = 1001
const WEB_SOCKET_PATH_PREFIX_DENYLIST = new Set(["_next", "api"])

const PROXY_REQUEST_HEADER_DENYLIST = new Set([
  "authorization",
  "connection",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
])

type RealtimeWebSocketProxyOptions = {
  readonly browserHeartbeatIntervalMs?: number
}

/**
 * Resolves optional same-origin web-to-realtime proxy configuration.
 *
 * @param env - Environment map to read.
 * @returns Proxy configuration when enabled, otherwise null.
 */
export function resolveRealtimeProxyConfig(
  env: RealtimeProxyEnv = process.env,
): RealtimeProxyConfig | null {
  const rawUrl = env.WW_REALTIME_PROXY_URL?.trim()
  if (!rawUrl) return null
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("WW_REALTIME_PROXY_URL must be a valid http(s) URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("WW_REALTIME_PROXY_URL must use http: or https:")
  }
  return { url: url.toString().replace(/\/+$/, "") }
}

/**
 * Checks whether one HTTP request path belongs to Colyseus matchmake APIs.
 *
 * @param rawUrl - Incoming request URL or path.
 * @returns True when the request should proxy to realtime.
 */
export function isRealtimeHttpProxyPath(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false
  const pathname = new URL(rawUrl, "http://wizard-wars.local").pathname
  return pathname.startsWith("/matchmake/")
}

/**
 * Checks whether one websocket upgrade path looks like a Colyseus room socket.
 *
 * @param rawUrl - Incoming upgrade URL or path.
 * @returns True when the websocket should proxy to realtime.
 */
export function isRealtimeWebSocketProxyPath(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false
  const url = new URL(rawUrl, "http://wizard-wars.local")
  if (url.pathname.startsWith("//")) return false
  const pathSegments = url.pathname.split("/").filter(Boolean)
  const sessionId = url.searchParams.get("sessionId")?.trim()
  return (
    pathSegments.length === 2 &&
    !WEB_SOCKET_PATH_PREFIX_DENYLIST.has(pathSegments[0] ?? "") &&
    sessionId !== undefined &&
    sessionId !== ""
  )
}

/**
 * Installs an Express middleware that proxies Colyseus matchmake HTTP routes.
 *
 * @param app - Express application that owns the public web origin.
 * @param config - Realtime target configuration.
 */
export function installRealtimeHttpProxy(
  app: Express,
  config: RealtimeProxyConfig,
): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isRealtimeHttpProxyPath(req.originalUrl ?? req.url)) {
      next()
      return
    }
    proxyHttpRequest(req, res, config)
  })
}

/**
 * Proxies one websocket upgrade to the internal realtime process.
 *
 * @param req - Original upgrade request.
 * @param socket - Client socket from the public web server.
 * @param head - Buffered bytes received with the upgrade.
 * @param config - Realtime target configuration.
 */
export function proxyRealtimeWebSocketUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  config: RealtimeProxyConfig,
  options: RealtimeWebSocketProxyOptions = {},
): void {
  const acceptor = new WebSocketServer({
    noServer: true,
    maxPayload: REALTIME_PROXY_MAX_PAYLOAD_BYTES,
  })
  try {
    const target = buildWebSocketTargetUrl(config, req.url)
    acceptor.handleUpgrade(req, socket, head, (clientWs) => {
      acceptor.close()
      bridgeRealtimeWebSockets(clientWs, target, options)
    })
  } catch {
    acceptor.close()
    writeBadGatewayAndClose(socket)
  }
}

/**
 * Proxies one regular HTTP request to the internal realtime process.
 *
 * @param req - Express request.
 * @param res - Express response.
 * @param config - Realtime target configuration.
 */
function proxyHttpRequest(
  req: Request,
  res: Response,
  config: RealtimeProxyConfig,
): void {
  const target = buildTargetUrl(config, req.originalUrl ?? req.url)
  const proxyReq = requestForProtocol(target.protocol)(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers: buildProxyRequestHeaders(req.headers, target),
    },
    (proxyRes) => {
      res.statusCode = proxyRes.statusCode ?? 502
      for (const [name, value] of Object.entries(proxyRes.headers)) {
        if (value !== undefined) res.setHeader(name, value)
      }
      proxyRes.pipe(res)
    },
  )
  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.status(502).json({ error: "Realtime proxy unavailable" })
      return
    }
    res.end()
  })
  req.pipe(proxyReq)
}

/**
 * Builds sanitized request headers for the internal matchmake hop.
 *
 * @param headers - Public request headers.
 * @param target - Internal realtime target URL.
 */
function buildProxyRequestHeaders(
  headers: IncomingHttpHeaders,
  target: URL,
): OutgoingHttpHeaders {
  const proxyHeaders: OutgoingHttpHeaders = {
    host: target.host,
  }
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase()
    if (value === undefined || PROXY_REQUEST_HEADER_DENYLIST.has(lowerName)) {
      continue
    }
    proxyHeaders[lowerName] = value
  }
  return proxyHeaders
}

/**
 * Builds a target URL preserving the incoming request path and query string.
 *
 * @param config - Realtime target configuration.
 * @param rawUrl - Original request URL.
 */
function buildTargetUrl(config: RealtimeProxyConfig, rawUrl: string | undefined): URL {
  const incoming = new URL(rawUrl ?? "/", "http://wizard-wars.local")
  const target = new URL(config.url)
  target.pathname = incoming.pathname
  target.search = incoming.search
  target.hash = ""
  return target
}

/**
 * Builds an internal websocket target URL preserving the public request path.
 *
 * @param config - Realtime target configuration.
 * @param rawUrl - Original request URL.
 */
function buildWebSocketTargetUrl(
  config: RealtimeProxyConfig,
  rawUrl: string | undefined,
): URL {
  const target = buildTargetUrl(config, rawUrl)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
  return target
}

/**
 * Bridges websocket frames between the public client and internal realtime server.
 *
 * @param clientWs - Public client websocket accepted by the web process.
 * @param target - Internal realtime websocket URL.
 */
function bridgeRealtimeWebSockets(
  clientWs: WebSocket,
  target: URL,
  options: RealtimeWebSocketProxyOptions,
): void {
  const realtimeWs = new WebSocket(target)
  const pendingMessages: PendingWebSocketMessage[] = []
  let pendingBytes = 0
  let browserAlive = true
  let closed = false
  const heartbeatIntervalMs =
    options.browserHeartbeatIntervalMs ??
    REALTIME_PROXY_BROWSER_HEARTBEAT_INTERVAL_MS
  const heartbeatTimer =
    heartbeatIntervalMs > 0
      ? setInterval(() => {
          if (clientWs.readyState !== WebSocket.OPEN) {
            closePair()
            return
          }
          if (!browserAlive) {
            closePair(
              REALTIME_PROXY_BROWSER_HEARTBEAT_CLOSE_CODE,
              Buffer.from("browser heartbeat missed"),
            )
            return
          }
          browserAlive = false
          clientWs.ping()
        }, heartbeatIntervalMs)
      : null

  const closePair = (code?: number, reason?: Buffer): void => {
    if (closed) return
    closed = true
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    closeWebSocket(clientWs, code, reason)
    closeWebSocket(realtimeWs, code, reason)
  }

  clientWs.on("pong", () => {
    browserAlive = true
  })
  realtimeWs.on("open", () => {
    for (const message of pendingMessages.splice(0)) {
      pendingBytes = Math.max(0, pendingBytes - rawDataByteLength(message.data))
      sendWebSocketFrame(realtimeWs, message.data, message.isBinary, closePair)
    }
  })
  clientWs.on("message", (data, isBinary) => {
    if (realtimeWs.readyState === WebSocket.OPEN) {
      sendWebSocketFrame(realtimeWs, data, isBinary, closePair)
      return
    }
    if (realtimeWs.readyState === WebSocket.CONNECTING) {
      pendingBytes += rawDataByteLength(data)
      if (pendingBytes > REALTIME_PROXY_MAX_BUFFERED_BYTES) {
        closePair(
          REALTIME_PROXY_BACKPRESSURE_CLOSE_CODE,
          Buffer.from("proxy buffer full"),
        )
        return
      }
      pendingMessages.push({ data, isBinary })
      return
    }
    closePair()
  })
  realtimeWs.on("message", (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      sendWebSocketFrame(clientWs, data, isBinary, closePair)
    }
  })
  clientWs.on("close", (code, reason) => closePair(code, reason))
  realtimeWs.on("close", (code, reason) => closePair(code, reason))
  clientWs.on("error", () => closePair())
  realtimeWs.on("error", () => closePair())
}

/**
 * Sends one websocket frame unless the destination is already over proxy budget.
 *
 * @param ws - Destination websocket.
 * @param data - Frame data.
 * @param isBinary - Whether the frame is binary.
 * @param closePair - Cleanup callback for send failures or backpressure.
 */
function sendWebSocketFrame(
  ws: WebSocket,
  data: RawData,
  isBinary: boolean,
  closePair: (code?: number, reason?: Buffer) => void,
): void {
  if (ws.bufferedAmount > REALTIME_PROXY_MAX_BUFFERED_BYTES) {
    closePair(
      REALTIME_PROXY_BACKPRESSURE_CLOSE_CODE,
      Buffer.from("proxy backpressure"),
    )
    return
  }
  ws.send(data, { binary: isBinary }, (err) => {
    if (err) closePair()
  })
}

/**
 * Returns byte length for one ws RawData frame.
 *
 * @param data - Frame data.
 */
function rawDataByteLength(data: RawData): number {
  if (Array.isArray(data)) {
    return data.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  }
  return data.byteLength
}

/**
 * Closes or terminates one websocket without throwing on already-closing sockets.
 *
 * @param ws - WebSocket to close.
 * @param code - Close code to propagate.
 * @param reason - Close reason to propagate.
 */
function closeWebSocket(ws: WebSocket, code?: number, reason?: Buffer): void {
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate()
    return
  }
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(code, reason)
  }
}

/**
 * Selects the Node request implementation for a URL protocol.
 *
 * @param protocol - URL protocol.
 */
function requestForProtocol(protocol: string): typeof httpRequest {
  return protocol === "https:" ? httpsRequest : httpRequest
}

/**
 * Writes a compact 502 response to an upgrade socket and closes it.
 *
 * @param socket - Client socket.
 */
function writeBadGatewayAndClose(socket: Duplex): void {
  socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
  socket.destroy()
}
