"use client"

import { useState } from "react"
import { LobbyStatusPill } from "@/components/lobby/LobbyChrome"

/** Hero display config — extend this to match your HERO_CONFIGS shape. */
export type HeroCardConfig = {
  id: string
  displayName: string
  desc?: string
  accent: string        // e.g. "#ef4444"
  bg: string            // e.g. "linear-gradient(145deg,#450a0a,#7f1d1d)"
  portraitBg: string    // e.g. "linear-gradient(180deg,#7f1d1d,#450a0a)"
  border: string        // e.g. "rgba(239,68,68,0.35)"
  overlayColor: string  // blend-mode color overlay for rune/highlight tint
  icon: string          // emoji glyph
}

/**
 * HERO_CARD_CONFIGS maps hero IDs to their visual config.
 * Import and extend this alongside HERO_CONFIGS from balance-config.
 */
export const HERO_CARD_CONFIGS: Record<string, HeroCardConfig> = {
  red_wizard: {
    id: "red_wizard",
    displayName: "Red Wizard",
    desc: "High burst damage. Rains arcane destruction from range.",
    accent: "#ef4444",
    bg: "linear-gradient(145deg,#450a0a,#7f1d1d)",
    portraitBg: "linear-gradient(180deg,#7f1d1d,#450a0a)",
    border: "rgba(239,68,68,0.35)",
    overlayColor: "rgba(220,38,38,0.55)",
    icon: "🔴",
  },
  barbarian: {
    id: "barbarian",
    displayName: "Barbarian",
    desc: "Unstoppable tank. Charges through enemies with sheer force.",
    accent: "#f97316",
    bg: "linear-gradient(145deg,#431407,#7c2d12)",
    portraitBg: "linear-gradient(180deg,#7c2d12,#431407)",
    border: "rgba(249,115,22,0.35)",
    overlayColor: "rgba(234,88,12,0.55)",
    icon: "🟠",
  },
  ranger: {
    id: "ranger",
    displayName: "Ranger",
    desc: "Swift and deadly. Kites opponents with precision shots.",
    accent: "#10b981",
    bg: "linear-gradient(145deg,#022c22,#064e3b)",
    portraitBg: "linear-gradient(180deg,#064e3b,#022c22)",
    border: "rgba(16,185,129,0.35)",
    overlayColor: "rgba(16,185,129,0.45)",
    icon: "🟢",
  },
}

// Sprite sheet constants (idle-south.png, ~1.29× scale)
// 124px native frame → 160px display; 496px native sheet → 643px display
const FRAME = 160
const SHEET_W = 643
// Vertical offset so the portrait shows head + upper chest
const SPRITE_TOP = -30

type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger"

function heroTone(heroId: string): StatusTone {
  if (heroId === "red_wizard") return "danger"
  if (heroId === "barbarian")  return "warning"
  if (heroId === "ranger")     return "success"
  return "neutral"
}

/**
 * HeroCard — horizontal card with sprite portrait column + text.
 * Drop-in replacement for the inline hero buttons in LobbyClient.tsx.
 *
 * Usage in LobbyClient.tsx:
 * ```tsx
 * import { HeroCard, HERO_CARD_CONFIGS } from "@/components/lobby/HeroCard"
 *
 * {Object.values(HERO_CONFIGS).map((hero) => (
 *   <HeroCard
 *     key={hero.id}
 *     config={HERO_CARD_CONFIGS[hero.id]}
 *     selected={myPlayer?.heroId === hero.id}
 *     onSelect={selectHero}
 *     disabled={!isConnected}
 *   />
 * ))}
 * ```
 *
 * Requires in globals.css:
 *   The sprite is served from /assets/sprites/heroes/lady-wizard/sheets/idle-south.png
 *   (already in public/ — no extra files needed).
 */
export function HeroCard({
  config,
  selected,
  onSelect,
  disabled = false,
}: {
  config: HeroCardConfig
  selected: boolean
  onSelect: (heroId: string) => void
  disabled?: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const active = selected || hovered

  const spriteStyle: React.CSSProperties = {
    position: "absolute",
    top: SPRITE_TOP,
    left: "50%",
    transform: "translateX(-50%)",
    width: FRAME,
    height: FRAME,
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(config.id)}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active ? config.bg : "rgba(255,255,255,0.03)",
        border: `1px solid ${active ? config.accent : "rgba(255,255,255,0.09)"}`,
        borderRadius: 14,
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        transition: "all 0.2s",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        width: "100%",
        height: 90,
        boxShadow: selected
          ? `0 8px 28px ${config.accent}40, inset 0 1px 0 rgba(255,255,255,0.1)`
          : hovered
            ? `0 4px 16px ${config.accent}25`
            : "none",
        transform: selected ? "scale(1.01)" : hovered ? "scale(1.005)" : "scale(1)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {/* ── Portrait column ── */}
      <div
        style={{
          position: "relative",
          width: 80,
          flexShrink: 0,
          overflow: "hidden",
          background: active ? config.portraitBg : "rgba(255,255,255,0.02)",
          borderRight: `1px solid ${active ? config.border : "rgba(255,255,255,0.06)"}`,
          transition: "background 0.2s",
        }}
      >
        {/* ambient glow */}
        <div
          style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            width: 100, height: 100, borderRadius: "50%",
            background: config.accent, filter: "blur(30px)",
            opacity: active ? 0.3 : 0.1, transition: "opacity 0.3s",
            pointerEvents: "none",
          }}
          aria-hidden
        />

        {/* sprite — first frame of idle-south (static, no animation) */}
        <div
          style={{
            ...spriteStyle,
            backgroundImage: "url(/assets/sprites/heroes/lady-wizard/sheets/idle-south.png)",
            backgroundSize: `${SHEET_W}px ${FRAME}px`,
            backgroundPosition: "0 0",
            backgroundRepeat: "no-repeat",
            imageRendering: "pixelated",
          }}
        />

        {/* mix-blend-mode:color overlay — tints bright rune/highlight pixels only */}
        <div
          style={{
            ...spriteStyle,
            background: config.overlayColor,
            mixBlendMode: "color",
            pointerEvents: "none",
          }}
          aria-hidden
        />
      </div>

      {/* ── Text column ── */}
      <div
        style={{
          flex: 1, minWidth: 0, padding: "13px 14px",
          display: "flex", flexDirection: "column",
          justifyContent: "center", gap: 5,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, lineHeight: 1 }}>{config.icon}</span>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
              {config.displayName}
            </p>
          </div>
          {selected && (
            <LobbyStatusPill tone={heroTone(config.id)}>Selected</LobbyStatusPill>
          )}
        </div>
        {config.desc && (
          <p style={{ fontSize: 11, color: "#475569", margin: 0, lineHeight: 1.5 }}>
            {config.desc}
          </p>
        )}
      </div>
    </button>
  )
}
