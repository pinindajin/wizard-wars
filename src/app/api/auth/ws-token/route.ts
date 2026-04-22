import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { AUTH_COOKIE_NAME, verifyToken } from "@/server/auth"

/**
 * Returns the session JWT for Colyseus `join` options.
 * The client cannot read HttpOnly `ww-token` from JavaScript.
 */
export async function GET(): Promise<NextResponse> {
  const jar = await cookies()
  const token = jar.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json({ token })
}
