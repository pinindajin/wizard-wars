"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { decodeJwt } from "jose"

import type {
  LobbyStatePayload,
  AnyWsMessage,
  MessageHandler,
} from "@/shared/types"
import { WsEvent } from "@/shared/events"
import type { GameConnection } from "@/game/network/GameConnection"

export type LobbyConnection = {
  connection: GameConnection | null
  lobbyState: LobbyStatePayload | null
  localPlayerId: string | null
  error: string | null
  isConnected: boolean
  onMessage: (handler: MessageHandler) => () => void
}

export const LobbyContext = createContext<LobbyConnection>({
  connection: null,
  lobbyState: null,
  localPlayerId: null,
  error: null,
  isConnected: false,
  onMessage: () => () => {},
})

export const useLobbyConnection = () => useContext(LobbyContext)

type Props = {
  readonly roomId: string
  readonly token: string
  readonly children: ReactNode
}

/**
 * Provides a managed WebSocket connection to a game lobby room.
 *
 * Handles JWT decoding for local player identity, manages the `GameConnection`
 * instance lifecycle, and provides a centralized `onMessage` stream for
 * UI components.
 */
export function LobbyConnectionProvider({ roomId, token, children }: Props) {
  const [connection, setConnection] = useState<GameConnection | null>(null)
  const [lobbyState, setLobbyState] = useState<LobbyStatePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handlersRef = useRef(new Set<MessageHandler>())

  // Decode local player ID from JWT for host/self checks
  const localPlayerId = useMemo(() => {
    try {
      const claims = decodeJwt(token) as { sub?: string }
      return typeof claims.sub === "string" ? claims.sub : null
    } catch {
      return null
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    let conn: GameConnection | null = null

    const connect = async () => {
      try {
        const { GameConnection } = await import("@/game/network/GameConnection")
        const { getColyseusUrl } = await import("@/lib/endpoints")

        conn = new GameConnection({
          serverUrl: getColyseusUrl(),
          token,
        })

        // Wire centralized state listeners
        conn.onMessage((message: AnyWsMessage) => {
          if (message.type === WsEvent.LobbyState) {
            setLobbyState(message.payload as LobbyStatePayload)
          }

          if (message.type === WsEvent.LobbyHostTransfer) {
            const transfer = message.payload as { hostPlayerId: string }
            setLobbyState((prev) => {
              if (!prev) return prev
              return {
                ...prev,
                hostPlayerId: transfer.hostPlayerId,
                players: prev.players.map((p) => ({
                  ...p,
                  isHost: p.playerId === transfer.hostPlayerId,
                })),
              }
            })
          }

          // Fan out to manual subscribers
          handlersRef.current.forEach((h) => h(message))
        })

        await conn.connectById(roomId)

        if (cancelled) {
          conn.close()
          return
        }

        setConnection(conn)
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to connect to lobby")
        }
      }
    }

    void connect()

    return () => {
      cancelled = true
      conn?.close()
      setConnection(null)
      setLobbyState(null)
      setError(null)
    }
  }, [roomId, token])

  const onMessage = (handler: MessageHandler) => {
    handlersRef.current.add(handler)
    return () => {
      handlersRef.current.delete(handler)
    }
  }

  return (
    <LobbyContext.Provider
      value={{
        connection,
        lobbyState,
        localPlayerId,
        error,
        isConnected: connection !== null,
        onMessage,
      }}
    >
      {children}
    </LobbyContext.Provider>
  )
}
