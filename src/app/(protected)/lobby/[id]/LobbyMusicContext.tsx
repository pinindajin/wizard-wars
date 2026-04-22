"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"

import { DEFAULT_BGM_VOLUME, LOBBY_MUSIC_PATH } from "@/shared/balance-config/audio"

const SESSION_KEY = "ww-lobby-muted"

/** Shape of the lobby music context value. */
type LobbyMusicContextValue = {
  /** Whether lobby music is currently muted. */
  readonly muted: boolean
  /** Toggle the mute state and persist it to sessionStorage. */
  readonly toggleMute: () => void
  /**
   * Signal that the user has interacted with the page, allowing
   * the AudioContext to resume (browser autoplay policy).
   */
  readonly onFirstInteraction: () => void
}

const LobbyMusicContext = createContext<LobbyMusicContextValue | null>(null)

/**
 * Reads the persisted mute preference from sessionStorage.
 *
 * @returns True if the user has previously muted lobby music this session.
 */
function readMuted(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1"
  } catch {
    return false
  }
}

/**
 * Writes the mute preference to sessionStorage.
 *
 * @param value - The new mute state to persist.
 */
function writeMuted(value: boolean): void {
  try {
    if (value) {
      sessionStorage.setItem(SESSION_KEY, "1")
    } else {
      sessionStorage.removeItem(SESSION_KEY)
    }
  } catch {
    // sessionStorage unavailable (private browsing edge case)
  }
}

/**
 * Provider component that manages lobby background music.
 * Music starts on first user interaction (respects browser autoplay policy).
 * Mute state is persisted in sessionStorage under `ww-lobby-muted`.
 *
 * @param props.children - React children to render inside the provider.
 */
export function LobbyMusicProvider({ children }: { children: React.ReactNode }) {
  const [muted, setMuted] = useState<boolean>(false)
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  const [started, setStarted] = useState(false)

  // Hydrate muted state from sessionStorage after mount (avoid SSR mismatch)
  useEffect(() => {
    setMuted(readMuted())
  }, [])

  // Sync audio element mute state when muted changes
  useEffect(() => {
    if (audio) {
      audio.muted = muted
    }
  }, [audio, muted])

  /**
   * Starts lobby music on first user interaction.
   * Safe to call multiple times — only acts on the first call.
   */
  const onFirstInteraction = useCallback(() => {
    if (started) return
    setStarted(true)

    const el = new Audio(LOBBY_MUSIC_PATH)
    el.loop = true
    el.volume = DEFAULT_BGM_VOLUME / 100
    el.muted = readMuted()
    el.play().catch(() => {
      // Autoplay still blocked — audio will start on next interaction
    })
    setAudio(el)
  }, [started])

  /**
   * Toggles the lobby music mute state and persists the preference.
   */
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      writeMuted(next)
      return next
    })
  }, [])

  // Tear down audio on unmount
  useEffect(() => {
    return () => {
      if (audio) {
        audio.pause()
        audio.src = ""
      }
    }
  }, [audio])

  return (
    <LobbyMusicContext.Provider value={{ muted, toggleMute, onFirstInteraction }}>
      {children}
    </LobbyMusicContext.Provider>
  )
}

/**
 * Hook to access the lobby music context.
 *
 * @returns The lobby music context value.
 * @throws If called outside of a `LobbyMusicProvider`.
 */
export function useLobbyMusic(): LobbyMusicContextValue {
  const ctx = useContext(LobbyMusicContext)
  if (!ctx) {
    throw new Error("useLobbyMusic must be used inside LobbyMusicProvider")
  }
  return ctx
}
