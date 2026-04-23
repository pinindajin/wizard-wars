import { describe, it, expect, vi } from "vitest"

import {
  getLoaderStatus,
  publishLoaderComplete,
  publishLoaderStatus,
  subscribeLoaderStatus,
  type LoaderStatus,
  type LoaderStatusHost,
} from "./loaderStatus"
import { WW_LOADER_STATUS_REGISTRY_KEY } from "./constants"

/**
 * Builds an in-memory stub host that mimics `Phaser.Game#registry` closely
 * enough for the bridge under test: a key/value store plus an event emitter
 * that fires `setdata` + `changedata` on every set, just like Phaser's
 * `DataManager`.
 *
 * @returns A fake host with a `setEvents` hook for assertions.
 */
function makeFakeHost(): LoaderStatusHost & {
  emitted: Array<{ event: string; value: LoaderStatus }>
} {
  type Listener = (parent: unknown, key: string, value: unknown) => void
  const listeners = new Map<string, Set<Listener>>()
  const store = new Map<string, unknown>()
  const emitted: Array<{ event: string; value: LoaderStatus }> = []

  const host: LoaderStatusHost & typeof addExtras = {
    registry: {
      set(key, value) {
        const existing = store.has(key)
        store.set(key, value)
        const evt = existing ? "changedata" : "setdata"
        for (const l of listeners.get(evt) ?? []) l(null, key, value)
        if (key === WW_LOADER_STATUS_REGISTRY_KEY) {
          emitted.push({ event: evt, value: value as LoaderStatus })
        }
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
    emitted,
  }

  const addExtras = { emitted } as const
  return host
}

describe("loaderStatus bridge", () => {
  it("publishLoaderStatus writes to the registry key and fires events", () => {
    const host = makeFakeHost()
    const status: LoaderStatus = {
      scene: "Boot",
      description: "Boot assets",
      fileKey: "logo",
      loaded: 1,
      total: 2,
      phase: "loading",
    }

    publishLoaderStatus(host, status)
    expect(getLoaderStatus(host)).toEqual(status)
    expect(host.emitted).toEqual([{ event: "setdata", value: status }])
  })

  it("subscribers receive updates in order and stop after unsubscribe", () => {
    const host = makeFakeHost()
    const seen: LoaderStatus[] = []
    const unsub = subscribeLoaderStatus(host, (s) => seen.push(s))

    const s1: LoaderStatus = {
      scene: "Boot",
      description: "Boot",
      fileKey: "a",
      loaded: 0,
      total: 1,
      phase: "loading",
    }
    const s2: LoaderStatus = { ...s1, loaded: 1 }

    publishLoaderStatus(host, s1)
    publishLoaderStatus(host, s2)
    unsub()
    publishLoaderStatus(host, { ...s2, scene: "Arena" })

    expect(seen).toEqual([s1, s2])
  })

  it("ignores registry updates for unrelated keys", () => {
    const host = makeFakeHost()
    const cb = vi.fn()
    subscribeLoaderStatus(host, cb)
    host.registry.set("some-other-key", { foo: "bar" })
    expect(cb).not.toHaveBeenCalled()
  })

  it("publishLoaderComplete emits phase='complete'", () => {
    const host = makeFakeHost()
    publishLoaderComplete(host)
    const s = getLoaderStatus(host)
    expect(s?.phase).toBe("complete")
    expect(s?.scene).toBe("Arena")
  })
})
