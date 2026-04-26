import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { Room } from "@colyseus/sdk"

import { playerLobbyIndex } from "@/server/colyseus/rooms/GameLobbyRoom"
import { LIGHTNING_CAST_MS } from "@/shared/balance-config"
import { RoomEvent } from "@/shared/roomEvents"
import type {
  LightningBoltPayload,
  LobbyStatePayload,
  PlayerInputPayload,
  ShopErrorPayload,
  ShopStatePayload,
} from "@/shared/types"

import {
  bootTestServer,
  createTestToken,
  delay,
  shutdownTestServer,
  type TestServer,
} from "./helpers/colyseus-test-server"

async function waitFor(
  cb: () => boolean,
  options: { readonly timeout: number },
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < options.timeout) {
    if (cb()) return
    await delay(25)
  }
  throw new Error(`Timed out after ${options.timeout}ms`)
}

function baseInput(seq: number): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 900,
    abilityTargetY: 384,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 900,
    weaponTargetY: 384,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: Date.now(),
  }
}

async function startSinglePlayerMatch(
  server: TestServer,
  userId: string,
): Promise<Room> {
  const token = await createTestToken(userId, userId)
  const room = await server.sdk.create("game_lobby", { token })

  let latestPhase = ""
  room.onMessage(RoomEvent.LobbyState, (state: LobbyStatePayload) => {
    latestPhase = state.phase
  })

  room.send(RoomEvent.LobbyStartGame, {})
  await waitFor(() => latestPhase === "WAITING_FOR_CLIENTS", { timeout: 5000 })

  room.send(RoomEvent.ClientSceneReady, {})
  await waitFor(() => latestPhase === "IN_PROGRESS", { timeout: 12_000 })

  return room
}

describe("lightning ability slot sync", { timeout: 30_000 }, () => {
  let server: TestServer

  beforeAll(async () => {
    server = await bootTestServer()
  })

  beforeEach(() => {
    playerLobbyIndex.clear()
  })

  afterAll(async () => {
    await shutdownTestServer(server)
  })

  it("syncs purchased lightning into the authoritative slot so hotkey 2 casts", async () => {
    const room = await startSinglePlayerMatch(server, "lightning-purchase-sync")
    const shopStates: ShopStatePayload[] = []
    const bolts: LightningBoltPayload[] = []

    room.onMessage(RoomEvent.ShopState, (state: ShopStatePayload) => {
      shopStates.push(state)
    })
    room.onMessage(RoomEvent.LightningBolt, (bolt: LightningBoltPayload) => {
      bolts.push(bolt)
    })

    room.send(RoomEvent.ShopPurchase, { itemId: "lightning_bolt" })
    await waitFor(
      () =>
        shopStates.some(
          (state) => state.abilitySlots[1] === "lightning_bolt",
        ),
      { timeout: 3000 },
    )

    room.send(RoomEvent.PlayerInput, {
      ...baseInput(1),
      abilitySlot: 1,
    })

    await waitFor(() => bolts.length > 0, {
      timeout: LIGHTNING_CAST_MS + 3000,
    })
    expect(bolts[0]!.casterId).toBe("lightning-purchase-sync")

    await room.leave().catch(() => {})
  })

  it("syncs reassigned lightning into the selected authoritative slot", async () => {
    const room = await startSinglePlayerMatch(server, "lightning-assign-sync")
    const shopStates: ShopStatePayload[] = []
    const bolts: LightningBoltPayload[] = []

    room.onMessage(RoomEvent.ShopState, (state: ShopStatePayload) => {
      shopStates.push(state)
    })
    room.onMessage(RoomEvent.LightningBolt, (bolt: LightningBoltPayload) => {
      bolts.push(bolt)
    })

    room.send(RoomEvent.ShopPurchase, { itemId: "lightning_bolt" })
    await waitFor(
      () =>
        shopStates.some(
          (state) => state.abilitySlots[1] === "lightning_bolt",
        ),
      { timeout: 3000 },
    )

    room.send(RoomEvent.AssignAbility, {
      itemId: "lightning_bolt",
      slotIndex: 2,
    })
    await waitFor(
      () =>
        shopStates.some(
          (state) =>
            state.abilitySlots[1] === null &&
            state.abilitySlots[2] === "lightning_bolt",
        ),
      { timeout: 3000 },
    )

    room.send(RoomEvent.PlayerInput, {
      ...baseInput(1),
      abilitySlot: 2,
    })

    await waitFor(() => bolts.length > 0, {
      timeout: LIGHTNING_CAST_MS + 3000,
    })
    expect(bolts[0]!.casterId).toBe("lightning-assign-sync")

    await room.leave().catch(() => {})
  })

  it("rejects assigning unowned lightning without mutating shop slots", async () => {
    const room = await startSinglePlayerMatch(server, "lightning-unowned")
    const errors: ShopErrorPayload[] = []
    const shopStates: ShopStatePayload[] = []

    room.onMessage(RoomEvent.ShopError, (error: ShopErrorPayload) => {
      errors.push(error)
    })
    room.onMessage(RoomEvent.ShopState, (state: ShopStatePayload) => {
      shopStates.push(state)
    })

    room.send(RoomEvent.AssignAbility, {
      itemId: "lightning_bolt",
      slotIndex: 2,
    })

    await waitFor(() => errors.length > 0, { timeout: 3000 })
    expect(errors[0]!.reason).toMatch(/not owned/i)
    expect(
      shopStates.some((state) => state.abilitySlots[2] === "lightning_bolt"),
    ).toBe(false)

    await room.leave().catch(() => {})
  })
})
