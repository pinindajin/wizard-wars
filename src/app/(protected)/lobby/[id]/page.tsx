import LobbyClient from "./LobbyClient"
import { LobbyMusicProvider } from "./LobbyMusicContext"

/**
 * Lobby page — server component wrapper.
 * Wraps the client lobby UI with the LobbyMusicProvider so that
 * music mute state is shared between lobby and (if rendered inline) game.
 *
 * @param props.params - Next.js dynamic route params containing the room `id`.
 */
export default async function LobbyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <LobbyMusicProvider>
      <LobbyClient roomId={id} />
    </LobbyMusicProvider>
  )
}
