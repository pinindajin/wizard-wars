"use client"

import type { ReactNode } from "react"

import {
  brandTitle,
  cardPanel,
  cardPanelOpaque,
  emptyStateCard,
  lobbyFrame,
  lobbyPage,
  lobbySurface,
  metaText,
  pageShell,
  sectionSubtitle,
  sectionTitle,
  sectionTitleCaps,
  statusPill,
  statusPillAccent,
  statusPillDanger,
  statusPillNeutral,
  statusPillSuccess,
  statusPillWarning,
} from "@/lib/ui/lobbyStyles"

type LobbyPanelTone = "default" | "solid"
type LobbyStatusTone = "neutral" | "accent" | "success" | "warning" | "danger"

/**
 * Joins an ordered list of class names into a single string.
 *
 * @param values - Class-name segments that may be nullish.
 * @returns The combined class-name string.
 */
function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}

/**
 * Wraps lobby pages in a shared centered shell with decorative background glows.
 *
 * @param props - Component props.
 * @param props.children - Page content rendered inside the lobby shell.
 * @returns Shared lobby page shell markup.
 */
export function LobbyShell({ children }: { children: ReactNode }) {
  return (
    <div className={joinClasses(pageShell, lobbyFrame)}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-48 -top-40 h-104 w-104 rounded-full bg-violet-500/14 blur-3xl" />
        <div className="absolute -right-40 top-32 h-88 w-88 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -bottom-48 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>
      <div className={lobbyPage}>
        <div className={lobbySurface}>{children}</div>
      </div>
    </div>
  )
}

/**
 * Renders the shared page header used across lobby surfaces.
 *
 * @param props - Component props.
 * @param props.eyebrow - Optional uppercase eyebrow label above the title.
 * @param props.title - Main page title text.
 * @param props.subtitle - Supporting subtitle text.
 * @param props.aside - Optional actions or metadata rendered on the right.
 * @returns Shared lobby page header markup.
 */
export function LobbyHeader({
  eyebrow,
  title,
  subtitle,
  aside,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  aside?: ReactNode
}) {
  return (
    <header className="mb-8 flex flex-col gap-5 border-b border-white/8 pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <p className={sectionTitleCaps}>{eyebrow}</p> : null}
        <h1 className={joinClasses("mt-3", brandTitle)}>{title}</h1>
        {subtitle ? <p className={sectionSubtitle}>{subtitle}</p> : null}
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-3">{aside}</div> : null}
    </header>
  )
}

/**
 * Renders a reusable content panel with optional title, subtitle, and header actions.
 *
 * @param props - Component props.
 * @param props.eyebrow - Optional small uppercase label.
 * @param props.title - Optional panel title.
 * @param props.subtitle - Optional helper copy under the title.
 * @param props.aside - Optional actions or metadata rendered in the header.
 * @param props.children - Panel body content.
 * @param props.className - Optional extra classes for the outer panel.
 * @param props.contentClassName - Optional extra classes for the body wrapper.
 * @param props.tone - Visual treatment for the panel background.
 * @returns Shared lobby panel markup.
 */
export function LobbyPanel({
  eyebrow,
  title,
  subtitle,
  aside,
  children,
  className,
  contentClassName,
  tone = "default",
}: {
  eyebrow?: string
  title?: string
  subtitle?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  tone?: LobbyPanelTone
}) {
  const panelTone = tone === "solid" ? cardPanelOpaque : cardPanel
  const hasHeader = eyebrow || title || subtitle || aside

  return (
    <section className={joinClasses(panelTone, className)}>
      {hasHeader ? (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {eyebrow ? <p className={sectionTitleCaps}>{eyebrow}</p> : null}
            {title ? <h2 className={joinClasses(eyebrow ? "mt-2" : "", sectionTitle)}>{title}</h2> : null}
            {subtitle ? <p className={sectionSubtitle}>{subtitle}</p> : null}
          </div>
          {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
        </div>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </section>
  )
}

/**
 * Renders a semantic status pill with shared chrome.
 *
 * @param props - Component props.
 * @param props.tone - Visual tone for the pill.
 * @param props.children - Status content.
 * @param props.className - Optional extra classes.
 * @returns Shared status-pill markup.
 */
export function LobbyStatusPill({
  tone,
  children,
  className,
}: {
  tone: LobbyStatusTone
  children: ReactNode
  className?: string
}) {
  const toneClass =
    tone === "accent"
      ? statusPillAccent
      : tone === "success"
        ? statusPillSuccess
        : tone === "warning"
          ? statusPillWarning
          : tone === "danger"
            ? statusPillDanger
            : statusPillNeutral

  return <span className={joinClasses(statusPill, toneClass, className)}>{children}</span>
}

/**
 * Renders a reusable empty state with optional action content.
 *
 * @param props - Component props.
 * @param props.eyebrow - Optional small label above the title.
 * @param props.title - Empty-state headline.
 * @param props.description - Supporting explanatory text.
 * @param props.action - Optional action element rendered below the copy.
 * @returns Shared empty-state markup.
 */
export function LobbyEmptyState({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className={emptyStateCard}>
      {eyebrow ? <p className={metaText}>{eyebrow}</p> : null}
      <h3 className="mt-3 text-xl font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
