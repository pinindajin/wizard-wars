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
import { resolveEffectiveAdmin } from "@/server/admin/auth"
import type { LobbyListEntry, LobbyListResponse, RealtimeLobbyListResponse } from "@/server/realtime/adminContracts"
import {
  RealtimeAdminError,
  isWebOnlyMode,
  requestRealtimeAdmin,
  resolveRealtimeAdminConfig,
} from "@/server/realtime/adminClient"
import { buildRealtimeLobbyList } from "@/server/realtime/lobbyAdminData"

export type { LobbyListEntry, LobbyListResponse }

const emptyLobbyListResponse = (isAdmin: boolean): LobbyListResponse => ({
  lobbies: [],
  viewer: { isAdmin },
})

/**
 * Converts realtime admin bridge failures into stable API responses.
 *
 * @param err - Error thrown while calling the realtime admin bridge.
 * @returns JSON response preserving bridge HTTP failures when available.
 */
function realtimeAdminErrorResponse(err: unknown): NextResponse {
  if (err instanceof RealtimeAdminError) {
    return NextResponse.json(err.body, { status: err.status })
  }
  return NextResponse.json({ error: "Realtime unavailable" }, { status: 503 })
}

/**
 * Returns the remote realtime lobby list when split-process admin bridge config is present.
 *
 * @param isAdmin - Whether the authenticated viewer is an admin.
 * @returns Realtime-backed response, web-only misconfiguration response, or null for single-process fallback.
 */
async function realtimeLobbyListResponse(isAdmin: boolean): Promise<NextResponse | null> {
  const config = resolveRealtimeAdminConfig()
  if (!config) {
    if (isWebOnlyMode()) {
      return NextResponse.json({ error: "Realtime admin bridge not configured" }, { status: 503 })
    }
    return null
  }

  try {
    const body = await requestRealtimeAdmin<RealtimeLobbyListResponse>({
      config,
      path: "/internal/lobbies",
    })
    return NextResponse.json({ lobbies: body.lobbies, viewer: { isAdmin } } satisfies LobbyListResponse)
  } catch (err) {
    return realtimeAdminErrorResponse(err)
  }
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

  let isAdmin = false

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
    const effectiveAdmin = await resolveEffectiveAdmin(prisma, auth)
    isAdmin = effectiveAdmin.isAdmin
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }

  try {
    const realtimeResponse = await realtimeLobbyListResponse(isAdmin)
    if (realtimeResponse) return realtimeResponse

    const matchMaker = (
      globalThis as unknown as {
        __wizardWarsMatchMaker?: typeof import("@colyseus/core").matchMaker
      }
    ).__wizardWarsMatchMaker

    if (!matchMaker) {
      console.error("[api/lobbies] global __wizardWarsMatchMaker missing — run via server.ts")
      return NextResponse.json(emptyLobbyListResponse(isAdmin), { status: 200 })
    }

    const rooms = await matchMaker.query({ name: "game_lobby" })
    const { lobbies } = buildRealtimeLobbyList(rooms)

    return NextResponse.json({ lobbies, viewer: { isAdmin } } satisfies LobbyListResponse)
  } catch {
    return NextResponse.json(emptyLobbyListResponse(isAdmin), { status: 200 })
  }
}
