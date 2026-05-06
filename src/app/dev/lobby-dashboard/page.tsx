import type { Metadata } from "next"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { AUTH_COOKIE_NAME } from "@/server/auth"
import { verifyAdminToken } from "@/server/admin/verifyAdminToken"
import { prisma } from "@/server/db"
import { LobbyDashboardClient } from "./LobbyDashboardClient"

export const metadata: Metadata = {
  title: "Wizard Wars - Lobby Dashboard",
  description: "Admin lobby dashboard for Wizard Wars.",
}

/**
 * Admin-only lobby dashboard page.
 *
 * @returns Lobby dashboard client shell.
 */
export default async function LobbyDashboardPage() {
  const cookieStore = await cookies()
  const admin = await verifyAdminToken(prisma, cookieStore.get(AUTH_COOKIE_NAME)?.value)

  if (!admin.ok) {
    if (admin.reason === "forbidden") notFound()
    redirect(`/login?next=${encodeURIComponent("/dev/lobby-dashboard")}`)
  }

  return <LobbyDashboardClient />
}
