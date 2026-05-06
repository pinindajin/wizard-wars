import type { PrismaClient } from "@prisma/client"

import {
  findExistingAuthUser,
  shouldVerifyUserOnProtected,
  verifyToken,
} from "@/server/auth"
import { resolveEffectiveAdmin, type EffectiveAdmin } from "@/server/admin/auth"
import type { AuthUser } from "@/shared/types"

export type AdminTokenVerification =
  | {
      readonly ok: true
      readonly auth: AuthUser
      readonly admin: EffectiveAdmin
    }
  | {
      readonly ok: false
      readonly reason: "missing_token" | "invalid_token" | "stale_user" | "forbidden"
    }

/**
 * Verifies a `ww-token` value and resolves whether the user has app-admin access.
 *
 * @param prisma - Prisma client surface needed for user/admin lookup.
 * @param token - Raw JWT from the auth cookie.
 * @returns Admin verification result with a machine-readable failure reason.
 */
export async function verifyAdminToken(
  prisma: PrismaClient,
  token: string | undefined,
): Promise<AdminTokenVerification> {
  if (!token) {
    return { ok: false, reason: "missing_token" }
  }

  let auth: AuthUser
  try {
    auth = await verifyToken(token)
  } catch {
    return { ok: false, reason: "invalid_token" }
  }

  if (shouldVerifyUserOnProtected()) {
    const user = await findExistingAuthUser(prisma, auth)
    if (!user) {
      return { ok: false, reason: "stale_user" }
    }
  }

  const admin = await resolveEffectiveAdmin(prisma, auth)
  if (!admin.isAdmin) {
    return { ok: false, reason: "forbidden" }
  }

  return { ok: true, auth, admin }
}
