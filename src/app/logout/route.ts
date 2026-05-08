import { type NextRequest, NextResponse } from "next/server"

import { createClearAuthCookie } from "@/server/auth"

/**
 * Clears the current auth cookie and redirects the browser to the login page.
 *
 * @param request - Incoming route-handler request.
 * @returns Redirect response with auth cookie cleared.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/login", request.url))
  response.headers.append("set-cookie", createClearAuthCookie())
  return response
}
