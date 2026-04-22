"use client"

import { FormEvent, useState } from "react"

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

type SignupResponse = {
  result?: { data?: { json?: unknown } }
  error?: { message?: string; json?: unknown }
}

export default function SignupPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
    <main className={authPage}>
      <div className="mb-8 text-center">
        <h1 className={brandTitle}>⚔ Wizard Wars</h1>
        <p className={subBrand}>Arena PvP for the brave</p>
      </div>

      <div className={cardPanelOpaque}>
        <h2 className="mb-6 text-2xl font-semibold">Create Account</h2>

        {error && (
          <div className={`mb-4 ${errorBanner}`}>{error}</div>
        )}

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="signup-username">
              Username
            </label>
            <input
              id="signup-username"
              className="w-full"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="3–20 chars, letters/numbers/underscore"
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <p className="text-xs text-gray-500">Letters, numbers, and underscores only.</p>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="signup-password">
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
          </div>

          <button className={btnPrimaryBlock} type="submit" disabled={loading}>
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Already have an account?{" "}
          <a href="/login" className={linkAccent}>
            Login
          </a>
        </p>
      </div>
    </main>
  )
}
