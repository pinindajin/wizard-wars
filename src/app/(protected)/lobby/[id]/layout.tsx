import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { AUTH_COOKIE_NAME } from "@/server/auth"
import { LobbyConnectionProvider } from "./LobbyConnectionProvider"
import { LobbyMusicProvider } from "./LobbyMusicContext"

/**
 * Lobby route layout — server component.
 * Ensures the user is authenticated via HttpOnly cookie and initializes
 * the shared lobby connection and music contexts.
 */
export default async function LobbyLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const jar = await cookies()
  const token = jar.get(AUTH_COOKIE_NAME)?.value

  if (!token) {
    redirect(`/login?next=/lobby/${id}`)
  }

  return (
    <LobbyMusicProvider>
      <LobbyConnectionProvider roomId={id} token={token}>
        {children}
      </LobbyConnectionProvider>
    </LobbyMusicProvider>
  )
}
