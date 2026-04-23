import type Phaser from "phaser"

import { WW_LOADER_STATUS_REGISTRY_KEY } from "./constants"

/** Scenes that publish loader progress to React. Kept small and explicit. */
export type LoaderScene = "Boot" | "Preload" | "Arena"

/**
 * Loader status payload written to the Phaser `game.registry`.
 * React components derive the overlay label (`Loading {description} [loaded/total]`)
 * from this shape.
 */
export type LoaderStatus = {
  readonly scene: LoaderScene
  /**
   * Human-readable description of the current loading segment, e.g.
   * `"Boot assets"`, `"Preload assets"`, `"Arena assets"`.
   */
  readonly description: string
  /** File key currently being loaded, or the last file that finished. */
  readonly fileKey: string
  /** Number of files in this pack that have finished (0-based cumulative). */
  readonly loaded: number
  /** Total number of files in this pack. */
  readonly total: number
  /**
   * `"loading"` while any pack is still in-flight; `"complete"` is emitted
   * exactly once by Arena after `editorCreate()` finishes (tilemap + anims
   * ready). React uses `complete` to unmount the loading overlay.
   */
  readonly phase: "loading" | "complete"
}

/**
 * Minimal Phaser surface used by the bridge. The real `Phaser.Game` satisfies
 * this shape; tests pass a tiny stub.
 */
export type LoaderStatusHost = {
  registry: {
    set: (key: string, value: unknown) => unknown
    get: (key: string) => unknown
    events: {
      on: (
        event: string,
        fn: (parent: unknown, key: string, value: unknown) => void,
      ) => unknown
      off: (
        event: string,
        fn: (parent: unknown, key: string, value: unknown) => void,
      ) => unknown
    }
  }
}

/**
 * Publishes a new loader status onto the game registry.
 *
 * Phaser's `DataManager` fires `setdata` and `changedata-<key>` events whenever
 * a value is set, which React subscribes to via {@link subscribeLoaderStatus}.
 *
 * @param host - The Phaser game instance (or compatible stub).
 * @param status - The new loader status to publish.
 */
export function publishLoaderStatus(
  host: LoaderStatusHost,
  status: LoaderStatus,
): void {
  host.registry.set(WW_LOADER_STATUS_REGISTRY_KEY, status)
}

/**
 * Reads the currently-published loader status, or `null` if nothing has been
 * published yet.
 *
 * @param host - The Phaser game instance (or compatible stub).
 * @returns The latest status, or `null`.
 */
export function getLoaderStatus(host: LoaderStatusHost): LoaderStatus | null {
  const value = host.registry.get(WW_LOADER_STATUS_REGISTRY_KEY)
  return (value as LoaderStatus | undefined) ?? null
}

/**
 * Subscribes to loader status changes. Fires synchronously on every
 * {@link publishLoaderStatus} call, in insertion order.
 *
 * @param host - The Phaser game instance (or compatible stub).
 * @param handler - Called with every new status.
 * @returns An unsubscribe function that removes the handler.
 */
export function subscribeLoaderStatus(
  host: LoaderStatusHost,
  handler: (status: LoaderStatus) => void,
): () => void {
  const listener = (_parent: unknown, key: string, value: unknown): void => {
    if (key !== WW_LOADER_STATUS_REGISTRY_KEY) return
    handler(value as LoaderStatus)
  }
  host.registry.events.on("setdata", listener)
  host.registry.events.on("changedata", listener)
  return () => {
    host.registry.events.off("setdata", listener)
    host.registry.events.off("changedata", listener)
  }
}

/**
 * Wires a Phaser Loader (`scene.load`) to publish progress to the registry.
 * Called by Boot / Preload / Arena `preload()` immediately after queuing their
 * pack file. The loader emits:
 *   - `filestart(file)` — about to fetch a file; we update description+fileKey.
 *   - `progress(value)` — cumulative 0..1 across queued files; derives loaded.
 *   - `complete()` — all queued files done; final `{ loaded: total }` emission.
 *
 * @param scene - The calling Phaser scene (used for `scene.load` and `scene.game.registry`).
 * @param params.scene - Logical scene tag published in the status payload.
 * @param params.description - Human-readable segment description for the overlay.
 */
export function wireSceneLoaderProgress(
  scene: Phaser.Scene,
  params: { readonly scene: LoaderScene; readonly description: string },
): void {
  const game = scene.game as unknown as LoaderStatusHost
  const loader = scene.load
  const tag = params.scene
  const desc = params.description

  loader.on("filestart", (file: { key?: string }) => {
    const total = loader.totalToLoad
    const loaded = Math.max(0, loader.totalComplete)
    publishLoaderStatus(game, {
      scene: tag,
      description: desc,
      fileKey: file.key ?? "",
      loaded,
      total,
      phase: "loading",
    })
  })

  loader.on("progress", (_value: number) => {
    const total = loader.totalToLoad
    const loaded = Math.max(0, loader.totalComplete)
    publishLoaderStatus(game, {
      scene: tag,
      description: desc,
      fileKey: "",
      loaded,
      total,
      phase: "loading",
    })
  })

  loader.on("complete", () => {
    const total = loader.totalToLoad
    publishLoaderStatus(game, {
      scene: tag,
      description: desc,
      fileKey: "",
      loaded: total,
      total,
      phase: "loading",
    })
  })
}

/**
 * Emits the terminal `phase: "complete"` status. Called by Arena's `create()`
 * (after `editorCreate()` finishes). React unmounts the loading overlay in
 * response.
 *
 * @param host - The Phaser game instance (or compatible stub).
 */
export function publishLoaderComplete(host: LoaderStatusHost): void {
  publishLoaderStatus(host, {
    scene: "Arena",
    description: "Arena ready",
    fileKey: "",
    loaded: 1,
    total: 1,
    phase: "complete",
  })
}
