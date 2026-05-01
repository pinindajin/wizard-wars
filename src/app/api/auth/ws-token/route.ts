import { type NextRequest, NextResponse } from "next/server"

import {
  AUTH_COOKIE_NAME,
  createClearAuthCookie,
  findExistingAuthUser,
  shouldVerifyUserOnProtected,
  verifyToken,
} from "@/server/auth"
import { prisma } from "@/server/db"

/**
 * Returns the session JWT plus verified identity for Colyseus `join` and lobby UI.
 * The client cannot read HttpOnly `ww-token` from JavaScript.
 * Success body: `{ token, sub, username }` matching `AuthUser` claims.
 *
 * Uses `NextRequest#cookies` so the token is read from the real Cookie header. With a custom
 * Node server (`server.ts` + `next getRequestHandler`), `next/headers` `cookies()` can be empty
 * in route handlers, while Edge middleware for pages still sees the session — that mismatch caused
 * "Not authenticated" in Global Chat for otherwise logged-in users.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const auth = await verifyToken(token)
    if (shouldVerifyUserOnProtected()) {
      const user = await findExistingAuthUser(prisma, auth)
      if (!user) {
        const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        response.headers.append("set-cookie", createClearAuthCookie())
        return response
      }
    }
    return NextResponse.json({
      token,
      sub: auth.sub,
      username: auth.username,
    })
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
}
