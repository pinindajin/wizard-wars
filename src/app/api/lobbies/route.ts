import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  AUTH_COOKIE_NAME,
  createClearAuthCookie,
  findExistingAuthUser,
  shouldVerifyUserOnProtected,
  verifyToken,
} from "@/server/auth"
import { prisma } from "@/server/db"

export type LobbyListEntry = {
  readonly lobbyId: string
  readonly lobbyPhase: "LOBBY" | "WAITING_FOR_CLIENTS" | "COUNTDOWN" | "IN_PROGRESS" | "SCOREBOARD"
  readonly hostName: string
  readonly hostPlayerId: string
  readonly playerCount: number
  readonly maxPlayers: number
  readonly createdAt: string
}

/**
 * GET /api/lobbies — Returns all open game_lobby rooms via Colyseus matchMaker.
 * Requires ww-token cookie for authentication.
 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const auth = await verifyToken(token)
    if (shouldVerifyUserOnProtected()) {
      const user = await findExistingAuthUser(prisma, auth)
      if (!user) {
        const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        response.headers.append("set-cookie", createClearAuthCookie())
        return response
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  try {
    const matchMaker = (
      globalThis as unknown as {
        __wizardWarsMatchMaker?: typeof import("@colyseus/core").matchMaker
      }
    ).__wizardWarsMatchMaker

    if (!matchMaker) {
      console.error("[api/lobbies] global __wizardWarsMatchMaker missing — run via server.ts")
      return NextResponse.json([], { status: 200 })
    }

    const rooms = await matchMaker.query({ name: "game_lobby" })
    const lobbies: LobbyListEntry[] = rooms
      .filter((r) => !r.locked)
      .map((r) => ({
        lobbyId: r.roomId,
        lobbyPhase: (r.metadata?.lobbyPhase as LobbyListEntry["lobbyPhase"]) ?? "LOBBY",
        hostName: (r.metadata?.hostName as string) ?? "",
        hostPlayerId: (r.metadata?.hostPlayerId as string) ?? "",
        playerCount: (r.metadata?.playerCount as number) ?? r.clients,
        maxPlayers: (r.metadata?.maxPlayers as number) ?? 12,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
      }))

    return NextResponse.json(lobbies)
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}
