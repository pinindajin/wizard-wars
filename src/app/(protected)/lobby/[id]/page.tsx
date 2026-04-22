import LobbyClient from "./LobbyClient"

/**
 * Lobby page — client component entry.
 * Consumes state from the shared `LobbyConnectionProvider` defined in `layout.tsx`.
 */
export default function LobbyPage() {
  return <LobbyClient />
}
