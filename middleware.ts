import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { requireAuthRedirect } from "./src/server/auth/middleware"

/**
 * Next.js edge middleware: redirects unauthenticated users away from protected routes.
 * Protected prefixes: /home, /lobby, /browse.
 */
export const middleware = async (request: NextRequest): Promise<NextResponse> => {
  const redirect = await requireAuthRedirect(request)
  return redirect ?? NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
