import type { PerformanceIssueKind } from "@/shared/performanceIndicators"
import { PERFORMANCE_ISSUE_ORDER } from "@/shared/performanceIndicators"

const ISSUE_METADATA: Record<
  PerformanceIssueKind,
  { readonly ariaLabel: string; readonly src: string }
> = {
  lost_connection: {
    ariaLabel: "Connection issue",
    src: "/assets/game/performance/lost-connection.png",
  },
  server_cpu: {
    ariaLabel: "Server loop degraded",
    src: "/assets/game/performance/server-cpu.png",
  },
  rubberbanding: {
    ariaLabel: "Rubber-banding detected",
    src: "/assets/game/performance/rubberbanding.png",
  },
}

type PerformanceIssueOverlayProps = {
  readonly issues: readonly PerformanceIssueKind[]
}

/**
 * Renders the in-game performance warning icon stack.
 *
 * @param props.issues - Active issue kinds to render in stable priority order.
 * @returns The warning overlay, or null when no issues are active.
 */
export default function PerformanceIssueOverlay({
  issues,
}: PerformanceIssueOverlayProps) {
  const active = new Set(issues)
  const ordered = PERFORMANCE_ISSUE_ORDER.filter((issue) => active.has(issue))

  if (ordered.length === 0) return null

  return (
    <div
      aria-label="Performance warnings"
      className="pointer-events-none absolute right-4 top-4 z-40 flex w-10 flex-col gap-2"
      data-testid="performance-issue-overlay"
    >
      {ordered.map((issue) => {
        const meta = ISSUE_METADATA[issue]
        return (
          <div
            aria-label={meta.ariaLabel}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-white/20 bg-black/60 shadow-lg shadow-black/40 backdrop-blur-sm"
            data-testid={`performance-issue-${issue}`}
            key={issue}
          >
            <img alt="" aria-hidden="true" className="h-8 w-8" src={meta.src} />
          </div>
        )
      })}
    </div>
  )
}
