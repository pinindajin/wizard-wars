import type { PrismaClient } from "@prisma/client"

import type { AuthUser } from "@/shared/types"

export const AdminReason = {
  UserIsAdmin: "user.isAdmin",
  AdminUsernames: "ADMIN_USERNAMES",
  AdminPrefix: "ADMIN_PREFIX",
} as const

export type AdminReason = (typeof AdminReason)[keyof typeof AdminReason]

export type AdminPolicy = {
  readonly exactUsernames: readonly string[]
  readonly prefix: string | null
}

export type AdminUser = {
  readonly id: string
  readonly username: string
  readonly usernameLower: string
  readonly isAdmin: boolean
}

export type EffectiveAdmin = {
  readonly user: AdminUser | null
  readonly isAdmin: boolean
  readonly reasons: readonly AdminReason[]
  readonly policy: AdminPolicy
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function parseAdminPolicy(env: NodeJS.ProcessEnv = process.env): AdminPolicy {
  const exactUsernames = (env.ADMIN_USERNAMES ?? "")
    .split(",")
    .map(normalizeUsername)
    .filter(Boolean)
  const prefix = normalizeUsername(env.ADMIN_PREFIX ?? "")
  return {
    exactUsernames,
    prefix: prefix.length > 0 ? prefix : null,
  }
}

export function resolveAdminReasons(user: AdminUser, policy = parseAdminPolicy()): AdminReason[] {
  const username = user.usernameLower || normalizeUsername(user.username)
  const reasons: AdminReason[] = []
  if (user.isAdmin) reasons.push(AdminReason.UserIsAdmin)
  if (policy.exactUsernames.includes(username)) reasons.push(AdminReason.AdminUsernames)
  if (policy.prefix && username.startsWith(policy.prefix)) reasons.push(AdminReason.AdminPrefix)
  return reasons
}

export async function resolveEffectiveAdmin(
  prisma: Pick<PrismaClient, "user">,
  auth: AuthUser,
  policy = parseAdminPolicy(),
): Promise<EffectiveAdmin> {
  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: {
      id: true,
      username: true,
      usernameLower: true,
      isAdmin: true,
    },
  })

  if (!user) {
    return { user: null, isAdmin: false, reasons: [], policy }
  }

  const reasons = resolveAdminReasons(user, policy)
  return {
    user,
    isAdmin: reasons.length > 0,
    reasons,
    policy,
  }
}
