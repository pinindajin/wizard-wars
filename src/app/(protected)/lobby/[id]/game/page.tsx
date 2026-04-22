import dynamic from "next/dynamic"

/**
 * Dynamically loaded with ssr:false so Phaser (and all transitive game
 * imports) are excluded from the SSR bundle. The game is browser-only.
 */
const LobbyGameHost = dynamic(() => import("./LobbyGameHost"), { ssr: false })

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
