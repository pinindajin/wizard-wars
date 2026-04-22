import LobbyGameHost from "./LobbyGameHost"

/**
 * Game page — server component wrapper for the in-match Phaser game host.
 *
 * @param props.params - Next.js dynamic route params containing the room `id`.
 */
export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LobbyGameHost lobbyId={id} />
}
