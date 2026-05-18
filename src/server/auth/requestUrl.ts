/**
 * Builds absolute URLs from request headers instead of only `request.url`.
 * The custom server can leave `request.url` at the default localhost:3000 origin
 * even when the real browser or proxy Host header uses another port/domain.
 */

type RequestUrlSource = {
  headers?: Headers
  url: string
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null
}

/**
 * Builds an absolute request URL that preserves proxy/local Host headers.
 *
 * @param request - Incoming request-like object.
 * @param path - Absolute path plus optional query string.
 * @returns URL rooted at the best request origin.
 */
export function buildRequestUrl(request: RequestUrlSource, path: string): URL {
  const requestUrl = new URL(request.url)
  const headers = request.headers ?? new Headers()
  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"))
  const host = forwardedHost ?? firstHeaderValue(headers.get("host"))
  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto"))
  const protocol = forwardedProto ? `${forwardedProto.replace(/:$/, "")}:` : requestUrl.protocol
  const origin = host ? `${protocol}//${host}` : requestUrl.origin

  return new URL(path, origin)
}
