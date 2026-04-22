"use client"

import { FormEvent, Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"

import { getTrpcMutationErrorMessage } from "../trpcMutationErrorMessage"
import {
  authPage,
  brandTitle,
  subBrand,
  cardPanelOpaque,
  errorBanner,
  btnPrimaryBlock,
  linkAccent,
} from "@/lib/ui/lobbyStyles"

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
    <main className={authPage}>
      <div className="mb-8 text-center">
        <h1 className={brandTitle}>⚔ Wizard Wars</h1>
        <p className={subBrand}>Arena PvP for the brave</p>
      </div>

      <div className={cardPanelOpaque}>
        <h2 className="mb-6 text-2xl font-semibold">Login</h2>

        {error && (
          <div className={`mb-4 ${errorBanner}`}>{error}</div>
        )}

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="login-username">
              Username
            </label>
            <input
              id="login-username"
              className="w-full"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="Username"
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="w-full"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button className={btnPrimaryBlock} type="submit" disabled={loading}>
            {loading ? "Logging in…" : "Login"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          No account?{" "}
          <a href="/signup" className={linkAccent}>
            Sign up
          </a>
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
