import { LobbyMusicProvider } from "@/app/(protected)/lobby/[id]/LobbyMusicContext"
import ChatClient from "./ChatClient"

/**
 * Home page — global lobby chat hub.
 * Music starts on first user interaction (autoplay policy).
 */
export default function HomePage() {
  return (
    <LobbyMusicProvider>
      <ChatClient />
    </LobbyMusicProvider>
  )
}
