import { type NextRequest, NextResponse } from "next/server"
import type { matchMaker as colyseusMatchMaker } from "@colyseus/core"

import {
  AUTH_COOKIE_NAME,
  createClearAuthCookie,
  findExistingAuthUser,
  shouldVerifyUserOnProtected,
  verifyToken,
} from "@/server/auth"
import { resolveEffectiveAdmin } from "@/server/admin/auth"
import { prisma } from "@/server/db"
import { logger } from "@/server/logger"
import type {
  AdminCloseLobbyInput,
  AdminCloseLobbyResult,
  GameLobbyRoom,
} from "@/server/colyseus/rooms/GameLobbyRoom"
import type { LobbyPhase } from "@/shared/types"

type RouteContext = {
  readonly params: Promise<{ readonly id: string }>
}

type WizardWarsMatchMaker = Pick<typeof colyseusMatchMaker, "getRoomById" | "remoteRoomCall">

function getMatchMaker(): WizardWarsMatchMaker | undefined {
  return (
    globalThis as unknown as {
      __wizardWarsMatchMaker?: WizardWarsMatchMaker
    }
  ).__wizardWarsMatchMaker
}

async function parseConfirmed(request: NextRequest): Promise<boolean> {
  try {
    const body = (await request.json()) as { readonly confirmed?: unknown }
    return body.confirmed === true
  } catch {
    return false
  }
}

function getListingPlayerCount(listing: {
  readonly clients?: number
  readonly metadata?: Record<string, unknown>
}): number {
  const metadataCount = listing.metadata?.playerCount
  if (typeof metadataCount === "number" && Number.isFinite(metadataCount)) {
    return metadataCount
  }
  return listing.clients ?? 0
}

function getListingPhase(listing: {
  readonly metadata?: Record<string, unknown>
}): LobbyPhase {
  return (listing.metadata?.lobbyPhase as LobbyPhase | undefined) ?? "LOBBY"
}

async function getRoomListing(
  matchMaker: WizardWarsMatchMaker,
  roomId: string,
): Promise<Awaited<ReturnType<WizardWarsMatchMaker["getRoomById"]>> | null> {
  try {
    return await Promise.resolve(matchMaker.getRoomById(roomId))
  } catch {
    return null
  }
}

function adminCloseResponse(result: AdminCloseLobbyResult): NextResponse {
  if (result.status === "confirmation_required") {
    return NextResponse.json(
      {
        error: "confirmation_required",
        occupied: true,
        playerCount: result.playerCount,
        lobbyPhase: result.lobbyPhase,
      },
      { status: 409 },
    )
  }
  return NextResponse.json(result, { status: 200 })
}

/**
 * POST /api/lobbies/[id]/close — Admin-only lobby close endpoint.
 *
 * The room re-checks live occupancy so stale browser/matchmaker metadata cannot
 * close an occupied room without confirmation.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let auth: Awaited<ReturnType<typeof verifyToken>>
  try {
    auth = await verifyToken(token)
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (shouldVerifyUserOnProtected()) {
    const user = await findExistingAuthUser(prisma, auth)
    if (!user) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      response.headers.append("set-cookie", createClearAuthCookie())
      return response
    }
  }

  const admin = await resolveEffectiveAdmin(prisma, auth)
  if (!admin.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const matchMaker = getMatchMaker()
  if (!matchMaker) {
    return NextResponse.json({ error: "Matchmaker unavailable" }, { status: 503 })
  }

  const { id: roomId } = await params
  const listing = await getRoomListing(matchMaker, roomId)
  if (!listing) {
    return NextResponse.json({ error: "Lobby not found" }, { status: 404 })
  }

  const confirmed = await parseConfirmed(request)
  const playerCount = getListingPlayerCount(listing)
  const lobbyPhase = getListingPhase(listing)

  logger.warn(
    {
      event: "admin.lobby_close.requested",
      area: "admin",
      side: "server",
      adminUserId: auth.sub,
      roomId,
      phase: lobbyPhase,
      playerCount,
      confirmed,
    },
    "Admin requested lobby close",
  )

  if (playerCount > 0 && !confirmed) {
    return NextResponse.json(
      {
        error: "confirmation_required",
        occupied: true,
        playerCount,
        lobbyPhase,
      },
      { status: 409 },
    )
  }

  const input: AdminCloseLobbyInput = {
    adminUserId: auth.sub,
    adminUsername: admin.user?.username ?? auth.username,
    confirmed,
  }

  try {
    const result = await matchMaker.remoteRoomCall<GameLobbyRoom>(
      roomId,
      "adminCloseLobby",
      [input],
    )
    return adminCloseResponse(result)
  } catch (err) {
    logger.error(
      {
        event: "admin.lobby_close.failed",
        area: "admin",
        side: "server",
        adminUserId: auth.sub,
        roomId,
        err,
      },
      "Admin lobby close failed",
    )
    return NextResponse.json({ error: "Failed to close lobby" }, { status: 500 })
  }
}
