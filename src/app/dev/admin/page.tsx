import type { Metadata } from "next"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { AUTH_COOKIE_NAME, verifyToken } from "@/server/auth"
import { resolveEffectiveAdmin } from "@/server/admin/auth"
import { prisma } from "@/server/db"
import { APP_CONFIG_ID, logger, resolveEnvLogLevel, setRuntimeLogLevel } from "@/server/logger"
import { SERVER_LOG_LEVELS, parseServerLogLevel } from "@/shared/logging/levels"
import type { AuthUser } from "@/shared/types"

export const metadata: Metadata = {
  title: "Wizard Wars — Admin",
  description: "Admin controls for Wizard Wars runtime configuration.",
}

type AdminPageProps = {
  readonly searchParams?: Promise<{
    readonly saved?: string
    readonly error?: string
  }>
}

async function requireAdmin() {
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    redirect("/login?next=/dev/admin")
  }

  let auth: AuthUser
  try {
    auth = await verifyToken(token)
  } catch {
    redirect("/login?next=/dev/admin")
  }

  const admin = await resolveEffectiveAdmin(prisma, auth)
  if (!admin.isAdmin) notFound()
  return admin
}

async function saveLogLevel(formData: FormData): Promise<void> {
  "use server"

  await requireAdmin()

  const rawLevel = String(formData.get("logLevel") ?? "")
  const nextDbLevel = rawLevel === "NONE" ? null : parseServerLogLevel(rawLevel)
  if (rawLevel !== "NONE" && !nextDbLevel) {
    redirect("/dev/admin?error=invalid-log-level")
  }

  await prisma.appConfig.upsert({
    where: { id: APP_CONFIG_ID },
    create: { id: APP_CONFIG_ID, logLevel: nextDbLevel },
    update: { logLevel: nextDbLevel },
  })

  const effectiveLevel = setRuntimeLogLevel(nextDbLevel)
  logger.warn(
    {
      event: "admin.log_level.updated",
      area: "admin",
      side: "server",
      dbLogLevel: nextDbLevel,
      effectiveLevel,
    },
    "Admin updated log level override",
  )

  redirect(`/dev/admin?saved=${effectiveLevel}`)
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "NONE"
}

function InfoRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{props.label}</dt>
      <dd className="mt-1 font-mono text-sm text-slate-100">{props.value}</dd>
    </div>
  )
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const admin = await requireAdmin()
  const params = await searchParams
  const config = await prisma.appConfig.findUnique({
    where: { id: APP_CONFIG_ID },
    select: { logLevel: true, updatedAt: true },
  })
  const appAdmins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true, username: true },
    orderBy: { usernameLower: "asc" },
  })

  const dbOverride = config?.logLevel ?? null
  const envLevel = resolveEnvLogLevel()
  const currentLevel = logger.level

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-slate-900 to-slate-950 p-8 shadow-2xl shadow-cyan-950/30">
          <p className="text-sm uppercase tracking-[0.28em] text-cyan-300">Wizard Wars Admin</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white">
            Runtime Controls
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Manage structured logging without redeploying. Saves update the DB override and this
            server process immediately.
          </p>
        </header>

        {params?.saved ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-950/35 px-5 py-4 text-sm text-emerald-100">
            Saved. This instance now uses <span className="font-mono">{params.saved}</span>.
            Other service instances pick it up on restart.
          </div>
        ) : null}
        {params?.error ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-950/35 px-5 py-4 text-sm text-red-100">
            Could not save admin setting: {params.error}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          <InfoRow label="Current process level" value={currentLevel} />
          <InfoRow label="Env/default level" value={envLevel} />
          <InfoRow label="DB override" value={dbOverride ?? "NONE"} />
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
          <h2 className="text-xl font-bold text-white">Log Level Override</h2>
          <p className="mt-2 text-sm text-slate-300">
            Choose <span className="font-mono">NONE</span> to clear the DB override and fall back to
            <span className="font-mono"> LOG_LEVEL</span>, then <span className="font-mono">warn</span>.
          </p>
          <form action={saveLogLevel} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm font-medium text-slate-200">
              DB log level
              <select
                name="logLevel"
                defaultValue={dbOverride ?? "NONE"}
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 font-mono text-sm text-white outline-none ring-cyan-400/30 focus:ring-4"
              >
                <option value="NONE">NONE</option>
                {SERVER_LOG_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-200"
            >
              Save Override
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Last DB update: {config?.updatedAt ? config.updatedAt.toISOString() : "never"}
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-xl font-bold text-white">Current Admin</h2>
            <dl className="mt-4 grid gap-3">
              <InfoRow label="Username" value={admin.user?.username ?? "unknown"} />
              <InfoRow label="User.isAdmin" value={admin.user?.isAdmin ? "true" : "false"} />
              <InfoRow label="Admin reasons" value={formatList(admin.reasons)} />
            </dl>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
            <h2 className="text-xl font-bold text-white">Admin Policy</h2>
            <dl className="mt-4 grid gap-3">
              <InfoRow label="ADMIN_USERNAMES" value={formatList(admin.policy.exactUsernames)} />
              <InfoRow label="ADMIN_PREFIX" value={admin.policy.prefix ?? "NONE"} />
              <InfoRow label="User.isAdmin admins" value={String(appAdmins.length)} />
            </dl>
            {appAdmins.length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                {appAdmins.map((user) => (
                  <li key={user.id} className="rounded-xl bg-white/[0.03] px-3 py-2 font-mono">
                    {user.username} <span className="text-slate-500">({user.id})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}
