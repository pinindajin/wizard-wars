import { type NextRequest, NextResponse } from "next/server"

import { buildRequestUrl, createClearAuthCookie } from "@/server/auth"

/**
 * Clears the current auth cookie and redirects the browser to the login page.
 *
 * @param request - Incoming route-handler request.
 * @returns Redirect response with auth cookie cleared.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(buildRequestUrl(request, "/login"))
  response.headers.append("set-cookie", createClearAuthCookie())
  return response
}
