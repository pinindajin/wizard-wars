import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { AUTH_COOKIE_NAME } from "./constants"
import { verifyToken } from "./jwt"
import { PROTECTED_PATHNAME_HEADER } from "./sessionRedirect"
import type { AuthUser } from "../../shared/types"

/**
 * Next.js middleware helpers: which URL prefixes require a logged-in user, how to read `ww-token`,
 * and how to redirect unauthenticated requests to `/login?next=...`.
 */

/** Path prefixes that require a valid JWT cookie. */
const PROTECTED_PATH_PREFIXES = ["/home", "/lobby", "/browse", "/dev/admin"] as const

/**
 * Returns whether `pathname` is under a protected app area.
 *
 * @param pathname - URL pathname from the request.
 * @returns `true` if the path requires authentication.
 */
export const isProtectedPath = (pathname: string): boolean => {
  return PROTECTED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/**
 * Builds request headers for downstream Node layouts. Middleware remains Edge/JWT-only;
 * DB-backed user checks read this server-overwritten path header later.
 *
 * @param request - Next.js request from middleware.
 * @returns Headers with the protected pathname header overwritten.
 */
export function withProtectedPathnameHeader(request: NextRequest): Headers {
  const requestHeaders = new Headers(request.headers)
  const pathnameWithSearch = `${request.nextUrl.pathname}${request.nextUrl.search}`
  requestHeaders.set(PROTECTED_PATHNAME_HEADER, pathnameWithSearch)
  return requestHeaders
}

/**
 * Reads `ww-token` from the request cookies and verifies it.
 * Returns `null` on missing or invalid token (fail-open for anonymous).
 *
 * @param request - Next.js request from middleware.
 * @returns `AuthUser` if valid, `null` otherwise.
 */
export const getUserFromRequest = async (request: NextRequest): Promise<AuthUser | null> => {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return null
  }
  try {
    return await verifyToken(token)
  } catch {
    return null
  }
}

/**
 * If the request targets a protected path and there is no valid user, returns a redirect to `/login`.
 * Returns `null` when no redirect is needed (public path or authenticated).
 *
 * @param request - Next.js request from middleware.
 * @returns `NextResponse` redirect or `null`.
 */
export const requireAuthRedirect = async (request: NextRequest): Promise<NextResponse | null> => {
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return null
  }
  const user = await getUserFromRequest(request)
  if (user) {
    return null
  }
  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("next", request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}
