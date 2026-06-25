import { Router, type Request, type Response } from "express"
import { matchMaker as defaultMatchMaker } from "@colyseus/core"

import type { AdminCloseLobbyInput, AdminCloseLobbyResult, GameLobbyRoom } from "./rooms/GameLobbyRoom"
import type { LobbyPhase } from "@/shared/types"
import type { InternalCloseLobbyRequest } from "@/server/realtime/adminContracts"
import {
  buildDashboardResponse,
  queryDashboardResponse,
  queryRealtimeLobbyList,
  type RealtimeMatchMaker,
} from "@/server/realtime/lobbyAdminData"

export type RealtimeAdminRouterOptions = {
  readonly adminToken?: string
  readonly matchMaker?: RealtimeMatchMaker
  readonly now?: () => Date
}

/**
 * Creates realtime health/readiness and authenticated internal admin routes.
 *
 * @param options - Router dependencies and service auth token.
 */
export function createRealtimeAdminRouter(options: RealtimeAdminRouterOptions = {}): Router {
  const router = Router()
  const matchMaker = options.matchMaker ?? defaultMatchMaker
  const now = options.now ?? (() => new Date())

  router.get("/healthz", (_req, res) => {
    res.json({ ok: true, role: "realtime" })
  })

  router.get("/readyz", (_req, res) => {
    res.json({ ok: true, role: "realtime" })
  })

  router.use("/internal", (req, res, next) => {
    const auth = authorizeInternalRequest(req, options.adminToken)
    if (auth.ok) {
      next()
      return
    }
    res.status(auth.status).json({ error: auth.error })
  })

  router.get("/internal/lobbies", async (_req, res) => {
    try {
      res.json(await queryRealtimeLobbyList(matchMaker, now()))
    } catch {
      res.status(503).json({ error: "Realtime unavailable" })
    }
  })

  router.post("/internal/lobbies/:id/close", async (req, res) => {
    const input = parseInternalCloseRequest(req.body)
    if (!input) {
      res.status(400).json({ error: "Invalid close request" })
      return
    }

    const listing = await getRoomListing(matchMaker, req.params.id)
    if (!listing) {
      res.status(404).json({ error: "Lobby not found" })
      return
    }

    const playerCount = getListingPlayerCount(listing)
    const lobbyPhase = getListingPhase(listing)
    if (playerCount > 0 && !input.confirmed) {
      res.status(409).json({
        error: "confirmation_required",
        occupied: true,
        playerCount,
        lobbyPhase,
      })
      return
    }

    try {
      const result = await matchMaker.remoteRoomCall<GameLobbyRoom>(
        req.params.id,
        "adminCloseLobby",
        [input satisfies AdminCloseLobbyInput],
      )
      sendAdminCloseResponse(res, result)
    } catch {
      res.status(500).json({ error: "Failed to close lobby" })
    }
  })

  router.get("/internal/dev/lobby-dashboard", async (_req, res) => {
    try {
      res.json(await queryDashboardResponse(matchMaker, now()))
    } catch {
      res.json(buildDashboardResponse(false, [], now().toISOString()))
    }
  })

  return router
}

/**
 * Authorizes an internal realtime admin request.
 *
 * @param req - Express request.
 * @param adminToken - Expected bearer token.
 */
function authorizeInternalRequest(
  req: Request,
  adminToken: string | undefined,
): { ok: true } | { ok: false; status: 401 | 403 | 503; error: string } {
  if (!adminToken?.trim()) {
    return { ok: false, status: 503, error: "Realtime admin auth is not configured" }
  }

  const auth = req.header("authorization")?.trim()
  if (!auth) {
    return { ok: false, status: 401, error: "Unauthorized" }
  }
  if (auth !== `Bearer ${adminToken}`) {
    return { ok: false, status: 403, error: "Forbidden" }
  }
  return { ok: true }
}

/**
 * Validates the internal close request body.
 *
 * @param body - Raw Express request body.
 */
function parseInternalCloseRequest(body: unknown): InternalCloseLobbyRequest | null {
  if (typeof body !== "object" || body === null) return null
  const input = body as Partial<InternalCloseLobbyRequest>
  if (
    typeof input.adminUserId !== "string" ||
    typeof input.adminUsername !== "string" ||
    typeof input.confirmed !== "boolean"
  ) {
    return null
  }
  return {
    adminUserId: input.adminUserId,
    adminUsername: input.adminUsername,
    confirmed: input.confirmed,
  }
}

/**
 * Returns the live Colyseus listing for a room id.
 *
 * @param matchMaker - Colyseus matchmaker.
 * @param roomId - Room id.
 */
async function getRoomListing(
  matchMaker: Pick<RealtimeMatchMaker, "getRoomById">,
  roomId: string,
): Promise<Awaited<ReturnType<RealtimeMatchMaker["getRoomById"]>> | null> {
  try {
    return await Promise.resolve(matchMaker.getRoomById(roomId))
  } catch {
    return null
  }
}

/**
 * Reads the live player count from matchmaker metadata.
 *
 * @param listing - Colyseus room listing.
 */
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

/**
 * Reads the live lobby phase from matchmaker metadata.
 *
 * @param listing - Colyseus room listing.
 */
function getListingPhase(listing: {
  readonly metadata?: Record<string, unknown>
}): LobbyPhase {
  return (listing.metadata?.lobbyPhase as LobbyPhase | undefined) ?? "LOBBY"
}

/**
 * Sends the current admin close response shape.
 *
 * @param res - Express response.
 * @param result - Room close result.
 */
function sendAdminCloseResponse(res: Response, result: AdminCloseLobbyResult): void {
  if (result.status === "confirmation_required") {
    res.status(409).json({
      error: "confirmation_required",
      occupied: true,
      playerCount: result.playerCount,
      lobbyPhase: result.lobbyPhase,
    })
    return
  }
  res.json(result)
}
