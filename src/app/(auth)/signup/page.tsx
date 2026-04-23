"use client"

import { FormEvent, useState } from "react"

import { getTrpcMutationErrorMessage } from "../trpcMutationErrorMessage"
import { LobbyWizardSprite } from "@/components/lobby/LobbyChrome"
import { btnPrimaryGold, errorBanner, linkAccent } from "@/lib/ui/lobbyStyles"

type SignupResponse = {
  result?: { data?: { json?: unknown } }
  error?: { message?: string; json?: unknown }
}

function passwordStrength(pw: string): { level: 0 | 1 | 2 | 3; label: string; color: string } {
  if (pw.length === 0) return { level: 0, label: "", color: "" }
  if (pw.length < 8)   return { level: 1, label: "Weak",   color: "#ef4444" }
  if (pw.length < 12)  return { level: 2, label: "Good",   color: "#f59e0b" }
  return                      { level: 3, label: "Strong", color: "#10b981" }
}

export default function SignupPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const strength = passwordStrength(password)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/trpc/auth.signup", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { username, password } }),
      })
      const payload = (await response.json()) as SignupResponse

      if (!response.ok || payload.error) {
        const message = getTrpcMutationErrorMessage(payload)
        setError(message ?? "Unable to sign up")
        return
      }

      window.location.assign("/home")
    } catch {
      setError("Unable to sign up")
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
      <div className="relative z-10 flex w-full max-w-[480px] flex-col justify-center px-12 py-14">
        {/* brand */}
        <div className="mb-9">
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
            Your legend begins here.
            <br />
            Choose your name wisely.
          </p>
        </div>

        {/* card */}
        <div className="rounded-2xl border border-white/[0.09] bg-[rgba(9,12,30,0.92)] p-8 shadow-[0_24px_64px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl">
          <h2
            className="mb-6 text-lg font-bold text-slate-100"
            style={{ fontFamily: "var(--font-cinzel), serif" }}
          >
            Create Your Wizard
          </h2>

          {error && (
            <div className={`mb-5 ${errorBanner}`}>{error}</div>
          )}

          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            {/* username */}
            <div className="space-y-1.5">
              <label
                className="block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500"
                htmlFor="signup-username"
              >
                Username
              </label>
              <input
                id="signup-username"
                className="w-full"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="3–20 chars — letters, numbers, underscore"
                maxLength={20}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <p className="text-[11px] text-slate-600">
                Letters, numbers, and underscores only.
              </p>
            </div>

            {/* password + strength meter */}
            <div className="space-y-1.5">
              <label
                className="block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500"
                htmlFor="signup-password"
              >
                Password
              </label>
              <input
                id="signup-password"
                className="w-full"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {/* strength bar — visible only once user starts typing */}
              {password.length > 0 && (
                <div className="flex items-center gap-2.5 pt-1">
                  <div className="h-[3px] flex-1 overflow-hidden rounded-sm bg-white/[0.07]">
                    <div
                      className="h-full rounded-sm transition-all duration-300"
                      style={{
                        width: `${(strength.level / 3) * 100}%`,
                        background: strength.color,
                      }}
                    />
                  </div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-[0.08em] transition-colors duration-300"
                    style={{ color: strength.color }}
                  >
                    {strength.label}
                  </span>
                </div>
              )}
            </div>

            <button className={btnPrimaryGold} type="submit" disabled={loading}>
              {loading ? "Forging your legend…" : "Join the Arena"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <a href="/login" className={linkAccent}>
              Sign in →
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
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-[#050813] to-transparent"
          aria-hidden
        />

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
              FORGE YOUR LEGEND
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Choose your hero. Master the arcane.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
