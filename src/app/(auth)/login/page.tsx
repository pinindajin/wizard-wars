"use client"

import { FormEvent, Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"

import { getTrpcMutationErrorMessage } from "../trpcMutationErrorMessage"
import { LobbyWizardSprite } from "@/components/lobby/LobbyChrome"
import { btnPrimaryGold, errorBanner, linkAccent } from "@/lib/ui/lobbyStyles"

type LoginResponse = {
  result?: { data?: { json?: unknown } }
  error?: { message?: string; json?: unknown }
}

const LoginForm = () => {
  const searchParams = useSearchParams()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/trpc/auth.login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { username, password } }),
      })
      const payload = (await response.json()) as LoginResponse

      if (!response.ok || payload.error) {
        const message = getTrpcMutationErrorMessage(payload)
        setError(message ?? "Unable to login")
        return
      }

      const next = searchParams.get("next")
      const target = next && next.startsWith("/") ? next : "/home"
      window.location.assign(target)
    } catch {
      setError("Unable to login")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="relative isolate flex min-h-screen overflow-hidden"
      style={{ background: "#050813" }}
    >
      {/* background glows */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-[8%] -top-[15%] h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(109,40,217,0.16)_0%,transparent_65%)]" />
        <div className="absolute -bottom-[12%] -right-[6%] h-[550px] w-[550px] rounded-full bg-[radial-gradient(circle,rgba(217,119,6,0.08)_0%,transparent_65%)]" />
      </div>

      {/* ── Left: form panel ── */}
      <div className="relative z-10 flex w-full max-w-[440px] flex-col justify-center px-12 py-14">
        {/* brand */}
        <div className="mb-10">
          <p
            className="mb-3 text-[10px] font-bold uppercase tracking-[0.35em] text-violet-400/80"
            style={{ fontFamily: "var(--font-cinzel), serif" }}
          >
            ⚔ Arena PvP
          </p>
          <h1
            className="text-[48px] font-black leading-[0.95] tracking-tight text-slate-50"
            style={{ fontFamily: "var(--font-cinzel), serif" }}
          >
            WIZARD
            <br />
            <span className="text-violet-400">WARS</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-500">
            Enter the arena. Command the arcane.
            <br />
            Claim your glory.
          </p>
        </div>

        {/* card */}
        <div className="rounded-2xl border border-white/[0.09] bg-[rgba(9,12,30,0.92)] p-8 shadow-[0_24px_64px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl">
          <h2
            className="mb-6 text-lg font-bold text-slate-100"
            style={{ fontFamily: "var(--font-cinzel), serif" }}
          >
            Welcome Back
          </h2>

          {error && (
            <div className={`mb-5 ${errorBanner}`}>{error}</div>
          )}

          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div className="space-y-1.5">
              <label
                className="block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500"
                htmlFor="login-username"
              >
                Username
              </label>
              <input
                id="login-username"
                className="w-full"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="Your wizard name"
                maxLength={20}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label
                className="block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500"
                htmlFor="login-password"
              >
                Password
              </label>
              <input
                id="login-password"
                className="w-full"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button className={btnPrimaryGold} type="submit" disabled={loading}>
              {loading ? "Entering the arena…" : "Enter the Arena"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            New wizard?{" "}
            <a href="/signup" className={linkAccent}>
              Create account →
            </a>
          </p>
        </div>
      </div>

      {/* ── Right: wizard showcase ── */}
      <div className="relative z-10 flex flex-1 items-center justify-center">
        {/* hex grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          aria-hidden
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='52'%3E%3Cpolygon points='30,2 58,17 58,37 30,50 2,37 2,17' fill='none' stroke='%23a78bfa' stroke-width='1'/%3E%3C/svg%3E")`,
            backgroundSize: "60px 52px",
          }}
        />
        {/* left edge fade */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-[#050813] to-transparent" aria-hidden />

        {/* ring glow */}
        <div
          className="pointer-events-none absolute h-72 w-72 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 65%)" }}
          aria-hidden
        />

        <div className="ww-fadein text-center">
          <LobbyWizardSprite scale={3} glowColor="#7c3aed" />
          <div className="mt-7">
            <p
              className="text-xl font-bold tracking-widest text-white/90"
              style={{ fontFamily: "var(--font-cinzel), serif" }}
            >
              ENTER THE ARENA
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Battle wizards from across the realm
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
