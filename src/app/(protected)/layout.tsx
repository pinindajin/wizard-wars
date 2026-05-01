import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import {
  AUTH_COOKIE_NAME,
  PROTECTED_PATHNAME_HEADER,
  buildSessionExpiredPath,
  findExistingAuthUser,
  sanitizeRelativeNext,
  shouldVerifyUserOnProtected,
  verifyToken,
} from "@/server/auth"
import { prisma } from "@/server/db"

/**
 * Shared protected route layout. Edge middleware handles JWT-only redirects; this
 * Node layout optionally verifies the DB user row when VERIFY_USER_ON_PROTECTED is enabled.
 *
 * @param props.children - Protected route content.
 */
export default async function ProtectedLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  if (!shouldVerifyUserOnProtected()) {
    return children
  }

  const headerStore = await headers()
  const nextPath = sanitizeRelativeNext(
    headerStore.get(PROTECTED_PATHNAME_HEADER),
  )
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value

  if (!token) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }

  try {
    const auth = await verifyToken(token)
    const user = await findExistingAuthUser(prisma, auth)
    if (user) return children
  } catch {
    // Fall through to cookie clearing redirect below.
  }

  redirect(buildSessionExpiredPath(nextPath))
}
