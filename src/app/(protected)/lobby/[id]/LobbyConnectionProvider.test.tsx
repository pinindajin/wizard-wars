/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { LobbyConnectionProvider, useLobbyConnection } from "./LobbyConnectionProvider"

// Mock dependencies
vi.mock("jose", () => ({
  decodeJwt: vi.fn(),
}))

vi.mock("@/lib/endpoints", () => ({
  getColyseusUrl: () => "ws://mock",
}))

const mockConnectById = vi.fn().mockResolvedValue(undefined)
const mockClose = vi.fn()
const mockOnMessage = vi.fn().mockReturnValue(() => {})

vi.mock("@/game/network/GameConnection", () => ({
  GameConnection: vi.fn().mockImplementation(() => ({
    connectById: mockConnectById,
    close: mockClose,
    onMessage: mockOnMessage,
  })),
}))

const TestComponent = () => {
  const { isConnected, localPlayerId, error } = useLobbyConnection()
  return (
    <div>
      <div data-testid="connected">{isConnected.toString()}</div>
      <div data-testid="player-id">{localPlayerId ?? "null"}</div>
      <div data-testid="error">{error ?? "none"}</div>
    </div>
  )
}

describe("LobbyConnectionProvider", () => {
  const roomId = "test-room"
  const token = "test-token"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("decodes localPlayerId from JWT on mount", async () => {
    const { decodeJwt } = await import("jose")
    vi.mocked(decodeJwt).mockReturnValue({ sub: "user-123" })

    render(
      <LobbyConnectionProvider roomId={roomId} token={token}>
        <TestComponent />
      </LobbyConnectionProvider>
    )

    expect(screen.getByTestId("player-id").textContent).toBe("user-123")
  })

  it("connects to the room on mount", async () => {
    render(
      <LobbyConnectionProvider roomId={roomId} token={token}>
        <TestComponent />
      </LobbyConnectionProvider>
    )

    await waitFor(() => {
      expect(mockConnectById).toHaveBeenCalledWith(roomId)
    })
    expect(screen.getByTestId("connected").textContent).toBe("true")
  })

  it("sets error state on connection failure", async () => {
    mockConnectById.mockRejectedValueOnce(new Error("Join failed"))

    render(
      <LobbyConnectionProvider roomId={roomId} token={token}>
        <TestComponent />
      </LobbyConnectionProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("Join failed")
    })
    expect(screen.getByTestId("connected").textContent).toBe("false")
  })

  it("closes connection on unmount", async () => {
    const { unmount } = render(
      <LobbyConnectionProvider roomId={roomId} token={token}>
        <TestComponent />
      </LobbyConnectionProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true")
    })

    unmount()
    expect(mockClose).toHaveBeenCalled()
  })
})
