import type { ErrorResponse } from "./adminContracts"

export type RealtimeAdminConfig = {
  readonly url: string
  readonly token: string
  readonly timeoutMs: number
}

export type RealtimeAdminEnv = { readonly [key: string]: string | undefined }

type FetchLike = typeof fetch

export type RealtimeAdminRequest = {
  readonly config: RealtimeAdminConfig
  readonly path: string
  readonly method?: "GET" | "POST"
  readonly body?: unknown
  readonly fetchImpl?: FetchLike
}

/**
 * Error thrown when the realtime admin bridge returns or maps an HTTP failure.
 */
export class RealtimeAdminError extends Error {
  readonly status: number
  readonly body: ErrorResponse | unknown

  /**
   * Creates a realtime admin HTTP error.
   *
   * @param status - HTTP status the web route should return.
   * @param body - JSON body the web route should return.
   */
  constructor(status: number, body: ErrorResponse | unknown) {
    super(typeof body === "object" && body !== null && "error" in body ? String(body.error) : "Realtime admin error")
    this.name = "RealtimeAdminError"
    this.status = status
    this.body = body
  }
}

/**
 * Resolves the optional web-to-realtime admin bridge configuration.
 *
 * @param env - Environment map to read.
 * @returns Config when both URL and token are present; otherwise null.
 */
export function resolveRealtimeAdminConfig(env: RealtimeAdminEnv = process.env): RealtimeAdminConfig | null {
  const url = env.WW_REALTIME_ADMIN_URL?.trim().replace(/\/+$/, "")
  const token = env.WW_REALTIME_ADMIN_TOKEN?.trim()
  if (!url || !token) return null

  const parsedTimeout = Number(env.WW_REALTIME_ADMIN_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout >= 100 ? Math.min(parsedTimeout, 30_000) : 2500
  return { url, token, timeoutMs }
}

/**
 * Returns true when this process is configured as web-only.
 *
 * @param env - Environment map to read.
 */
export function isWebOnlyMode(env: RealtimeAdminEnv = process.env): boolean {
  return env.WW_SERVER_MODE?.trim().toLowerCase() === "web"
}

/**
 * Requests an authenticated realtime admin endpoint and parses the JSON response.
 *
 * @param input - Request options.
 * @returns Parsed JSON response.
 * @throws RealtimeAdminError when the realtime service is unavailable, times out, or returns non-2xx.
 */
export async function requestRealtimeAdmin<T = unknown>(input: RealtimeAdminRequest): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs)
  const fetchImpl = input.fetchImpl ?? fetch
  const url = new URL(input.path, `${input.config.url}/`).toString()

  try {
    const res = await fetchImpl(url, {
      method: input.method ?? "GET",
      headers: {
        authorization: `Bearer ${input.config.token}`,
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
      cache: "no-store",
    })

    const parsed = await parseJsonResponse(res)
    if (!res.ok) {
      throw new RealtimeAdminError(res.status, parsed)
    }
    return parsed as T
  } catch (err) {
    if (err instanceof RealtimeAdminError) throw err
    if (isAbortError(err)) {
      throw new RealtimeAdminError(504, { error: "Realtime admin timeout" })
    }
    throw new RealtimeAdminError(503, { error: "Realtime unavailable" })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Parses a fetch response as JSON with a stable fallback body.
 *
 * @param res - Fetch Response.
 * @returns Parsed response body.
 */
async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

/**
 * Detects fetch abort errors across DOM and Node implementations.
 *
 * @param err - Unknown caught error.
 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { readonly name?: unknown }).name === "AbortError"
  )
}
