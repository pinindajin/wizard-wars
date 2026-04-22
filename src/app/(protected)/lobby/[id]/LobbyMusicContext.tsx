"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
 * Provider component that manages lobby background music for game lobbies only.
 * Attempts autoplay on mount; if blocked, retries on first pointer or key press.
 * Mute state is persisted in sessionStorage under `ww-lobby-muted`.
 *
 * @param props.children - React children to render inside the provider.
 */
export function LobbyMusicProvider({ children }: { children: React.ReactNode }) {
  const [muted, setMuted] = useState<boolean>(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Hydrate muted state from sessionStorage after mount (avoid SSR mismatch)
  useEffect(() => {
    setMuted(readMuted())
  }, [])

  // Sync audio element mute state when muted changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = muted
    }
  }, [muted])

  /**
   * Ensures the lobby audio element exists and attempts playback (retry after autoplay blocks).
   */
  const tryStartLobbyMusic = useCallback(() => {
    let el = audioRef.current
    if (!el) {
      el = new Audio(LOBBY_MUSIC_PATH)
      el.loop = true
      el.volume = DEFAULT_BGM_VOLUME / 100
      el.muted = readMuted()
      audioRef.current = el
    }
    void el.play().catch(() => {
      // Still blocked until user gesture — listener below retries
    })
  }, [])

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

  // Autoplay on mount + unlock on first user activation if needed
  useEffect(() => {
    tryStartLobbyMusic()

    const onActivation = () => {
      tryStartLobbyMusic()
      window.removeEventListener("pointerdown", onActivation)
      window.removeEventListener("keydown", onActivation)
    }
    window.addEventListener("pointerdown", onActivation)
    window.addEventListener("keydown", onActivation)

    return () => {
      window.removeEventListener("pointerdown", onActivation)
      window.removeEventListener("keydown", onActivation)
    }
  }, [tryStartLobbyMusic])

  // Tear down audio on unmount
  useEffect(() => {
    return () => {
      const el = audioRef.current
      if (el) {
        el.pause()
        el.src = ""
        audioRef.current = null
      }
    }
  }, [])

  return (
    <LobbyMusicContext.Provider value={{ muted, toggleMute }}>
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
