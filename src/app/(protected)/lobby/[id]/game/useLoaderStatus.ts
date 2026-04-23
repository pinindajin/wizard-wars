"use client"

import { useSyncExternalStore } from "react"

import {
  getLoaderStatus,
  subscribeLoaderStatus,
  type LoaderStatus,
  type LoaderStatusHost,
} from "@/game/loaderStatus"

const NULL_SUBSCRIBE = (_notify: () => void) => () => {}

/**
 * React hook that mirrors the Phaser loader status registry into component
 * state via `useSyncExternalStore`. Re-renders on every `publishLoaderStatus`
 * call. Returns `null` when no game handle is available (initial mount).
 *
 * @param game - The running Phaser game (or a stub satisfying `LoaderStatusHost`).
 *               Pass `null` when not yet mounted and the hook will no-op.
 * @returns The latest loader status, or `null` if unknown.
 */
export function useLoaderStatus(
  game: LoaderStatusHost | null,
): LoaderStatus | null {
  const subscribe = (notify: () => void): (() => void) => {
    if (!game) return NULL_SUBSCRIBE(notify)
    return subscribeLoaderStatus(game, () => notify())
  }
  const getSnapshot = (): LoaderStatus | null =>
    game ? getLoaderStatus(game) : null
  const getServerSnapshot = (): LoaderStatus | null => null

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
