"use client"

import { FormEvent, useState } from "react"

import { getTrpcMutationErrorMessage } from "../trpcMutationErrorMessage"

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
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold text-purple-400">⚔ Wizard Wars</h1>
        <p className="mt-2 text-sm text-gray-400">Arena PvP for the brave</p>
      </div>
      <h2 className="mb-6 text-2xl font-semibold">Create Account</h2>
      {error && (
        <div className="mb-4 rounded border border-red-500 bg-red-900/30 p-3 text-sm text-red-300">
          {error}
        </div>
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
        <button
          className="w-full rounded-md bg-purple-600 py-2.5 text-sm font-semibold hover:bg-purple-700 disabled:opacity-50"
          type="submit"
          disabled={loading}
        >
          {loading ? "Creating account…" : "Create Account"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-gray-400">
        Already have an account?{" "}
        <a href="/login" className="text-purple-400 hover:underline">
          Login
        </a>
      </p>
    </main>
  )
}
