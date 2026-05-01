import type { PrismaClient } from "@prisma/client"

import type { AuthUser } from "@/shared/types"

/**
 * Finds the DB row for a verified JWT auth user and returns DB-backed identity claims.
 *
 * @param prismaClient - Prisma client used for the lookup.
 * @param auth - Verified JWT auth payload.
 * @returns DB-backed auth user, or null when the row is missing.
 */
export async function findExistingAuthUser(
  prismaClient: PrismaClient,
  auth: AuthUser,
): Promise<AuthUser | null> {
  const user = await prismaClient.user.findUnique({
    where: { id: auth.sub },
    select: { id: true, username: true },
  })
  if (!user) return null
  return { sub: user.id, username: user.username }
}

/**
 * Requires the DB row for a verified JWT auth user.
 *
 * @param prismaClient - Prisma client used for the lookup.
 * @param auth - Verified JWT auth payload.
 * @returns DB-backed auth user.
 * @throws Error when the DB row is missing.
 */
export async function requireExistingAuthUser(
  prismaClient: PrismaClient,
  auth: AuthUser,
): Promise<AuthUser> {
  const user = await findExistingAuthUser(prismaClient, auth)
  if (!user) {
    throw new Error("auth user row missing")
  }
  return user
}
