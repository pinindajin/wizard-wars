"use client"

import type { ReactNode } from "react"
import { useState, useEffect, useRef } from "react"

import {
  brandTitle,
  cardPanel,
  cardPanelOpaque,
  emptyStateCard,
  lobbyFrame,
  lobbyPage,
  lobbySurface,
  metaText,
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

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ")
}

// ── Avatar colours (one per letter bucket) ──────────────────────────────────
const AVATAR_GRADIENTS = [
  ["#6d28d9", "#c4b5fd"],
  ["#065f46", "#6ee7b7"],
  ["#991b1b", "#fca5a5"],
  ["#92400e", "#fcd34d"],
  ["#1e40af", "#93c5fd"],
  ["#9d174d", "#f9a8d4"],
] as const

/**
 * Circular avatar with a colour derived from the first letter of `name`.
 */
export function LobbyAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const idx = Math.abs((name.charCodeAt(0) || 65) - 65) % AVATAR_GRADIENTS.length
  const [bg, fg] = AVATAR_GRADIENTS[idx]
  return (
    <div
      aria-label={name}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 35%, ${fg}, ${bg})`,
        boxShadow: `0 0 8px ${bg}55`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        color: "#fff",
        flexShrink: 0,
        fontFamily: "var(--font-cinzel), serif",
      }}
    >
      {name[0].toUpperCase()}
    </div>
  )
}

/**
 * Styled chat message bubble with sender avatar.
 */
export function LobbyChatBubble({
  username,
  text,
  time,
  fresh = false,
}: {
  username: string
  text: string
  time?: string
  fresh?: boolean
}) {
  return (
    <div
      className={joinClasses("flex gap-2.5 items-start", fresh ? "ww-msg-in" : undefined)}
    >
      <LobbyAvatar name={username} size={26} />
      <div className="flex-1 min-w-0 rounded-[3px_12px_12px_12px] border border-white/[0.07] bg-white/[0.04] px-3 py-2">
        <span className="text-[11px] font-semibold text-violet-300">{username}</span>
        {time && (
          <>
            <span className="mx-1.5 text-[11px] text-slate-700">·</span>
            <span className="text-[10px] text-slate-700">{time}</span>
          </>
        )}
        <p className="mt-1 text-[13px] leading-relaxed text-slate-300 break-words">{text}</p>
      </div>
    </div>
  )
}

/**
 * Animated lady-wizard sprite. Cycles idle → cast → idle on a timer.
 * Requires CSS keyframes from globals.css: ww-idle-{scale}x, ww-cast-{scale}x.
 */
export function LobbyWizardSprite({
  scale = 3,
  glowColor = "#7c3aed",
}: {
  scale?: 2 | 3
  glowColor?: string
}) {
  const [anim, setAnim] = useState<"idle" | "cast">("idle")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const cycle = () => {
      timerRef.current = setTimeout(
        () => {
          setAnim("cast")
          timerRef.current = setTimeout(() => {
            setAnim("idle")
            cycle()
          }, 1700)
        },
        3500 + Math.random() * 1200,
      )
    }
    cycle()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const size = 124 * scale
  const isIdle = anim === "idle"
  const animClass = isIdle ? `ww-sprite-idle-${scale}x` : `ww-sprite-cast-${scale}x`

  return (
    <div className="relative inline-block">
      {/* glow pedestal */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full"
        style={{
          bottom: -16,
          width: size * 0.65,
          height: 28,
          background: glowColor,
          filter: "blur(22px)",
          opacity: isIdle ? 0.32 : 0.75,
          transition: "opacity 0.4s",
          animation: "ww-pulse-glow 2.8s ease-in-out infinite",
        }}
      />
      <div
        className={joinClasses("ww-sprite", animClass)}
        style={{
          width: size,
          height: size,
          backgroundSize: isIdle ? `${496 * scale}px ${size}px` : `${2108 * scale}px ${size}px`,
          filter: isIdle ? "none" : `drop-shadow(0 0 14px ${glowColor})`,
          transition: "filter 0.3s",
        }}
      />
    </div>
  )
}

/**
 * Wraps lobby pages in a shared centered shell with decorative background glows.
 */
export function LobbyShell({ children }: { children: ReactNode }) {
  return (
    <div className={joinClasses(lobbyFrame)}>
      {/* background radial glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-[8%] -top-[15%] h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(109,40,217,0.16)_0%,transparent_65%)]" />
        <div className="absolute -bottom-[12%] -right-[6%] h-[550px] w-[550px] rounded-full bg-[radial-gradient(circle,rgba(217,119,6,0.09)_0%,transparent_65%)]" />
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(79,70,229,0.07)_0%,transparent_65%)]" />
      </div>

      {/* hex grid texture */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.025]"
        aria-hidden
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='52'%3E%3Cpolygon points='30,2 58,17 58,37 30,50 2,37 2,17' fill='none' stroke='%23a78bfa' stroke-width='1'/%3E%3C/svg%3E")`,
          backgroundSize: "60px 52px",
        }}
      />

      <div
        className="min-h-screen"
        style={{ background: "#050813" }}
      >
        <div className={lobbyPage}>
          <div className={lobbySurface}>{children}</div>
        </div>
      </div>
    </div>
  )
}

/**
 * Renders the shared page header used across lobby surfaces.
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
    <header className="mb-8 flex flex-col gap-5 border-b border-white/[0.07] pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className={sectionTitleCaps}>{eyebrow}</p>
        ) : null}
        <h1
          className={joinClasses("mt-2", brandTitle)}
          style={{ fontFamily: "var(--font-cinzel), serif" }}
        >
          {title}
        </h1>
        {subtitle ? <p className={joinClasses("mt-2", sectionSubtitle)}>{subtitle}</p> : null}
      </div>
      {aside ? (
        <div className="flex flex-wrap items-center gap-3">{aside}</div>
      ) : null}
    </header>
  )
}

/**
 * Renders a reusable content panel.
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
            {title ? (
              <h2 className={joinClasses(eyebrow ? "mt-2" : "", sectionTitle)}>{title}</h2>
            ) : null}
            {subtitle ? <p className={sectionSubtitle}>{subtitle}</p> : null}
          </div>
          {aside ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>
          ) : null}
        </div>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </section>
  )
}

/**
 * Renders a semantic status pill.
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

  return (
    <span className={joinClasses(statusPill, toneClass, className)}>{children}</span>
  )
}

/**
 * Renders a reusable empty state.
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
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
