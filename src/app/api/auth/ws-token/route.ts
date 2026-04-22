import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { AUTH_COOKIE_NAME, verifyToken } from "@/server/auth"

/**
 * Returns the session JWT plus verified identity for Colyseus `join` and lobby UI.
 * The client cannot read HttpOnly `ww-token` from JavaScript.
 * Success body: `{ token, sub, username }` matching `AuthUser` claims.
 */
export async function GET(): Promise<NextResponse> {
  const jar = await cookies()
  const token = jar.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const auth = await verifyToken(token)
    return NextResponse.json({
      token,
      sub: auth.sub,
      username: auth.username,
    })
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
}
