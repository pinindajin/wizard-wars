/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest"
import { act, render, screen } from "@testing-library/react"

import {
  publishLoaderStatus,
  type LoaderStatus,
  type LoaderStatusHost,
} from "@/game/loaderStatus"
import { WW_LOADER_STATUS_REGISTRY_KEY } from "@/game/constants"
import { useLoaderStatus } from "./useLoaderStatus"

/**
 * In-memory `LoaderStatusHost` used by these tests.
 * Mirrors Phaser's `DataManager` events (`setdata` + `changedata`).
 */
function makeFakeHost(): LoaderStatusHost {
  type Listener = (parent: unknown, key: string, value: unknown) => void
  const listeners = new Map<string, Set<Listener>>()
  const store = new Map<string, unknown>()
  return {
    registry: {
      set(key, value) {
        const existing = store.has(key)
        store.set(key, value)
        const evt = existing ? "changedata" : "setdata"
        for (const l of listeners.get(evt) ?? []) l(null, key, value)
        return value
      },
      get(key) {
        return store.get(key)
      },
      events: {
        on(event, fn) {
          if (!listeners.has(event)) listeners.set(event, new Set())
          listeners.get(event)!.add(fn)
          return fn
        },
        off(event, fn) {
          listeners.get(event)?.delete(fn)
          return fn
        },
      },
    },
  }
}

const seen: LoaderStatus[] = []

function Probe({ game }: { game: LoaderStatusHost | null }) {
  const status = useLoaderStatus(game)
  if (status && seen[seen.length - 1] !== status) seen.push(status)
  return <span data-testid="val">{status ? JSON.stringify(status) : "null"}</span>
}

describe("useLoaderStatus", () => {
  beforeEach(() => {
    seen.length = 0
  })

  it("returns null when no game is attached", () => {
    render(<Probe game={null} />)
    expect(screen.getByTestId("val").textContent).toBe("null")
  })

  it("re-renders with every published status", () => {
    const host = makeFakeHost()
    render(<Probe game={host} />)

    const s1: LoaderStatus = {
      scene: "Boot",
      description: "Boot assets",
      fileKey: "logo",
      loaded: 0,
      total: 1,
      phase: "loading",
    }
    act(() => publishLoaderStatus(host, s1))
    expect(screen.getByTestId("val").textContent).toBe(JSON.stringify(s1))

    const s2: LoaderStatus = { ...s1, loaded: 1, phase: "loading" }
    act(() => publishLoaderStatus(host, s2))
    expect(screen.getByTestId("val").textContent).toBe(JSON.stringify(s2))
  })

  it("picks up a pre-existing registry value on mount", () => {
    const host = makeFakeHost()
    const pre: LoaderStatus = {
      scene: "Preload",
      description: "Preload assets",
      fileKey: "",
      loaded: 3,
      total: 3,
      phase: "loading",
    }
    host.registry.set(WW_LOADER_STATUS_REGISTRY_KEY, pre)

    render(<Probe game={host} />)
    expect(screen.getByTestId("val").textContent).toBe(JSON.stringify(pre))
  })
})
