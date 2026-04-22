/**
 * Shared Tailwind class-string tokens for auth, global chat, pre-game lobby, and in-game
 * HUD chrome. Aligns Wizard Wars with the battle-click card+grid layout while keeping WW's
 * purple brand. Primary CTAs → purple; start/success → green; secondary actions → ghost.
 */

// ── Page shells ──────────────────────────────────────────────────────────────

/** Full-height dark background for the app; base for all page roots. */
export const pageShell =
  "min-h-screen bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.18),_transparent_32%),linear-gradient(180deg,_#0b1020_0%,_#11162a_45%,_#0a0f1d_100%)] text-white"

/** Auth pages: narrow centered column. */
export const authPage = `mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6`

/** Chat + lobby pages: roomy centered shell for card-based layouts. */
export const lobbyPage = "mx-auto min-h-screen w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10"

/** Decorative outer frame for lobby pages. */
export const lobbyFrame = "relative isolate overflow-hidden"

/** Raised inner shell used to group page content. */
export const lobbySurface =
  "relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/45 px-4 py-5 shadow-[0_24px_80px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:px-6 sm:py-6 lg:px-8 lg:py-8"

/** Reusable 2-column shell with a sidebar and main content area. */
export const lobbyMainGrid = "grid gap-6 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]"

/** Standard vertical stack for sidebar cards. */
export const lobbySidebarStack = "flex flex-col gap-6"

// ── Grid ─────────────────────────────────────────────────────────────────────

/** Legacy responsive grid kept for existing callers. */
export const gridThreeCols = "grid grid-cols-1 gap-6 md:grid-cols-3"

/** Chat panel spanning 2 of 3 columns. */
export const gridChatSpan = "flex min-h-[32rem] flex-col md:col-span-2"

// ── Card panels ──────────────────────────────────────────────────────────────

/** Standard semi-transparent bordered card. */
export const cardPanel =
  "rounded-3xl border border-white/10 bg-slate-900/75 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.35)] backdrop-blur-sm"

/** Opaque card for sidebars and auth forms. */
export const cardPanelOpaque =
  "rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.35)]"

/** Kicked/error state card. */
export const cardPanelKicked =
  "rounded-[28px] border border-red-500/40 bg-slate-950/90 p-8 text-center shadow-[0_20px_60px_rgba(127,29,29,0.35)] backdrop-blur-sm"

/** Alternate card treatment for accent or inset sections. */
export const cardInset =
  "rounded-2xl border border-white/8 bg-white/[0.04] p-4 shadow-inner shadow-black/15"

/** Compact row card for scan-heavy lists. */
export const cardRow =
  "rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.22)] transition-colors duration-150"

/** Empty-state card used across lobby pages. */
export const emptyStateCard =
  "flex min-h-[18rem] flex-col items-center justify-center rounded-3xl border border-dashed border-white/12 bg-slate-950/50 px-6 py-10 text-center"

// ── Typography ────────────────────────────────────────────────────────────────

/** Card/section heading. */
export const sectionTitle = "text-base font-semibold tracking-tight text-white"

/** All-caps smaller section label (e.g. "Select Hero"). */
export const sectionTitleCaps =
  "text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-violet-200/70"

/** Supporting text shown below section titles. */
export const sectionSubtitle = "mt-1 text-sm leading-6 text-slate-300"

/** Online-users strip label. */
export const onlineLabelClass = "font-medium text-slate-300"

/** Chat message sender name. */
export const messageName = "font-semibold text-violet-300"

/** Chat message body text. */
export const messageBody = "text-slate-200"

/** Separator colour in chat messages. */
export const messageSep = "text-slate-500"

/** Brand logo title. */
export const brandTitle = "text-3xl font-semibold tracking-tight text-white sm:text-4xl"

/** Brand subtitle / tagline. */
export const subBrand = "mt-2 max-w-2xl text-sm leading-6 text-slate-300"

/** Small status/meta text for headers and labels. */
export const metaText = "text-xs font-medium uppercase tracking-[0.2em] text-slate-400"

// ── Inputs ────────────────────────────────────────────────────────────────────

/** Inline chat input (flex-1 sibling to Send button). */
export const inputChat =
  "flex-1 rounded-2xl border border-white/12 bg-slate-950/85 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-violet-400/70 focus:outline-none focus:ring-4 focus:ring-violet-500/15"

/** Subtle framed scrollable body used for chat logs. */
export const chatViewport =
  "rounded-2xl border border-white/8 bg-slate-950/45 p-4 shadow-inner shadow-black/20"

// ── Buttons ───────────────────────────────────────────────────────────────────

/** Purple primary action (inline, e.g. Send). */
export const btnPrimary =
  "rounded-2xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(139,92,246,0.28)] transition hover:bg-violet-400 active:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"

/** Purple primary full-width (auth forms). */
export const btnPrimaryBlock =
  "w-full rounded-2xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(139,92,246,0.28)] transition hover:bg-violet-400 active:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"

/** Green success/start action, full-width. */
export const btnSuccessBlock =
  "w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-[0_10px_30px_rgba(16,185,129,0.24)] transition hover:bg-emerald-400 active:bg-emerald-600 active:text-white disabled:cursor-not-allowed disabled:opacity-50"

/** Ghost/secondary (navigation, toggle). */
export const btnGhost =
  "rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"

/** Compact ghost control for small utility actions. */
export const btnGhostCompact =
  "rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/[0.08]"

// ── Feedback ──────────────────────────────────────────────────────────────────

/** Inline error banner. */
export const errorBanner =
  "rounded-2xl border border-red-500/35 bg-red-950/35 p-3 text-sm text-red-100 shadow-[0_8px_24px_rgba(127,29,29,0.2)]"

/** Link accent colour. */
export const linkAccent = "text-violet-300 hover:text-violet-200 hover:underline"

/** Base pill for status indicators. */
export const statusPill =
  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]"

/** Neutral pill for inactive/default states. */
export const statusPillNeutral = "border-white/10 bg-white/[0.04] text-slate-200"

/** Accent pill for branded emphasis. */
export const statusPillAccent = "border-violet-400/30 bg-violet-500/12 text-violet-100"

/** Success pill for active/healthy states. */
export const statusPillSuccess = "border-emerald-400/30 bg-emerald-500/12 text-emerald-100"

/** Warning pill for pending/loading states. */
export const statusPillWarning = "border-amber-400/30 bg-amber-500/12 text-amber-100"

/** Danger pill for destructive/in-progress locked states. */
export const statusPillDanger = "border-rose-400/30 bg-rose-500/12 text-rose-100"

// ── Overlay / HUD ─────────────────────────────────────────────────────────────

/** Semi-transparent scrim used for loading gates and countdowns. */
export const overlayScrim =
  "absolute inset-0 z-40 flex flex-col items-center justify-center"

/** Inline style object for the loading-gate background tint. */
export const overlayScrimStyle = { backgroundColor: "rgba(0,0,0,0.55)" } as const

/** Floating card inside an overlay (LoadingGate, etc.). */
export const overlayCard =
  "flex flex-col items-center gap-4 rounded-2xl border border-gray-600/80 bg-gray-900/90 px-10 py-8 shadow-xl backdrop-blur-sm"

/** In-game HUD top-left panel (HP / lives / gold). */
export const hudTopPanel =
  "absolute left-4 top-4 flex flex-col gap-1 rounded-lg border border-gray-600/50 bg-black/60 px-3 py-2 text-sm text-white shadow-lg backdrop-blur-sm"
