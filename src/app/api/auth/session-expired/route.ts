import { type NextRequest, NextResponse } from "next/server"

import {
  buildSessionExpiredLoginPath,
  createClearAuthCookie,
  sanitizeRelativeNext,
} from "@/server/auth"

/**
 * Clears a stale auth cookie and redirects the user to login with a safe next path.
 *
 * @param request - Incoming route-handler request.
 * @returns Redirect response with auth cookie cleared.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const next = sanitizeRelativeNext(request.nextUrl.searchParams.get("next"))
  const response = NextResponse.redirect(
    new URL(buildSessionExpiredLoginPath(next), request.url),
  )
  response.headers.append("set-cookie", createClearAuthCookie())
  return response
}
