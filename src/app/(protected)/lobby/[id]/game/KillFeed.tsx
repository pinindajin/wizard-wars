"use client"

/** One row in the kill feed. */
export type KillFeedRow = {
  readonly key: string
  readonly text: string
}

/**
 * Text-only rolling kill feed (newest at the bottom).
 *
 * @param props.entries - Visible rows (newest last); parent controls cap and TTL.
 */
export default function KillFeed({
  entries,
}: {
  readonly entries: readonly KillFeedRow[]
}) {
  if (entries.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute left-4 top-24 z-40 flex max-h-40 max-w-sm flex-col gap-1 text-left"
      data-testid="kill-feed"
      aria-live="polite"
      aria-relevant="additions"
    >
      {entries.map((row) => (
        <div
          key={row.key}
          className="rounded bg-black/55 px-2 py-1 font-mono text-[11px] text-gray-200 shadow-md backdrop-blur-sm"
        >
          {row.text}
        </div>
      ))}
    </div>
  )
}
