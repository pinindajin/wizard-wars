/**
 * Shared Tailwind class-string tokens for auth, global chat, pre-game lobby, and in-game
 * HUD chrome. Updated for the 2026 visual redesign: darker glass cards, Cinzel brand font,
 * gold primary CTA, and new component tokens.
 */

// ── Page shells ──────────────────────────────────────────────────────────────

/** Full-height dark background for the app; base for all page roots. */
export const pageShell =
  "min-h-screen bg-[#050813] bg-[radial-gradient(ellipse_at_top_left,rgba(109,40,217,0.16)_0%,transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(217,119,6,0.08)_0%,transparent_55%)] text-white relative isolate overflow-hidden"

/** Auth pages: narrow centered column (mobile fallback; desktop uses split layout). */
export const authPage = "mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6"

/** Chat + lobby pages: roomy centered shell for card-based layouts. */
export const lobbyPage = "mx-auto min-h-screen w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10"

/** Decorative outer frame for lobby pages. */
export const lobbyFrame = "relative isolate overflow-hidden"

/** Raised inner shell used to group page content. */
export const lobbySurface =
  "relative overflow-hidden rounded-[28px] border border-white/[0.07] bg-[rgba(8,11,26,0.7)] px-4 py-5 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-[10px] sm:px-6 sm:py-6 lg:px-8 lg:py-8"

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

/** Standard semi-transparent glass card. */
export const cardPanel =
  "rounded-2xl border border-white/[0.09] bg-[rgba(9,12,30,0.88)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.45)] backdrop-blur-2xl"

/** Opaque card for sidebars and auth forms. */
export const cardPanelOpaque =
  "rounded-2xl border border-white/[0.09] bg-[rgba(9,12,30,0.95)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.45)]"

/** Kicked/error state card. */
export const cardPanelKicked =
  "rounded-[28px] border border-red-500/40 bg-slate-950/90 p-8 text-center shadow-[0_20px_60px_rgba(127,29,29,0.35)] backdrop-blur-sm"

/** Alternate card treatment for accent or inset sections. */
export const cardInset =
  "rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 shadow-inner shadow-black/20"

/** Compact row card for scan-heavy lists. */
export const cardRow =
  "rounded-xl border border-white/[0.08] bg-[rgba(255,255,255,0.03)] px-4 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.22)] transition-colors duration-150"

/** Empty-state card used across lobby pages. */
export const emptyStateCard =
  "flex min-h-[18rem] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-[rgba(9,12,30,0.6)] px-6 py-10 text-center"

// ── Typography ────────────────────────────────────────────────────────────────

/** Card/section heading. */
export const sectionTitle = "text-sm font-semibold tracking-tight text-white"

/** All-caps smaller section label. */
export const sectionTitleCaps =
  "text-[0.625rem] font-bold uppercase tracking-[0.25em] text-violet-300/70"

/** Supporting text shown below section titles. */
export const sectionSubtitle = "mt-1 text-xs leading-relaxed text-slate-400"

/** Online-users strip label. */
export const onlineLabelClass = "font-medium text-slate-300"

/** Chat message sender name. */
export const messageName = "font-semibold text-violet-300"

/** Chat message body text. */
export const messageBody = "text-slate-200"

/** Separator colour in chat messages. */
export const messageSep = "text-slate-600"

/** Brand logo title — uses Cinzel font variable. */
export const brandTitle =
  "font-[family-name:var(--font-cinzel)] text-3xl font-black tracking-tight text-white sm:text-4xl"

/** Brand subtitle / tagline. */
export const subBrand = "mt-2 max-w-2xl text-sm leading-6 text-slate-400"

/** Small status/meta text for headers and labels. */
export const metaText = "text-[0.625rem] font-bold uppercase tracking-[0.2em] text-slate-400"

// ── Inputs ────────────────────────────────────────────────────────────────────

/** Inline chat input (flex-1 sibling to Send button). */
export const inputChat =
  "flex-1 rounded-xl border border-white/[0.1] bg-[rgba(4,6,18,0.9)] px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-violet-500/60 focus:outline-none focus:ring-[3px] focus:ring-violet-500/14"

/** Subtle framed scrollable body used for chat logs. */
export const chatViewport =
  "rounded-xl border border-white/[0.06] bg-[rgba(4,6,18,0.6)] p-3 shadow-inner shadow-black/20"

// ── Buttons ───────────────────────────────────────────────────────────────────

/** Violet gradient primary action (inline, e.g. Send). */
export const btnPrimary =
  "rounded-xl bg-gradient-to-br from-violet-600 to-violet-800 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(124,58,237,0.32)] transition-all hover:from-violet-500 hover:to-violet-700 hover:shadow-[0_8px_28px_rgba(124,58,237,0.55)] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"

/** Violet gradient primary full-width (lobby forms). */
export const btnPrimaryBlock =
  "w-full rounded-xl bg-gradient-to-br from-violet-600 to-violet-800 px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(124,58,237,0.32)] transition-all hover:from-violet-500 hover:to-violet-700 hover:shadow-[0_8px_28px_rgba(124,58,237,0.55)] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"

/** Gold gradient primary full-width — used on auth CTA buttons. */
export const btnPrimaryGold =
  "w-full rounded-xl bg-gradient-to-br from-amber-600 to-amber-800 px-4 py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(217,119,6,0.35)] transition-all hover:from-amber-500 hover:to-amber-700 hover:shadow-[0_8px_28px_rgba(217,119,6,0.55)] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"

/** Green success/start action, full-width. */
export const btnSuccessBlock =
  "w-full rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-800 px-4 py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(5,150,105,0.3)] transition-all hover:from-emerald-500 hover:to-emerald-700 hover:shadow-[0_8px_28px_rgba(5,150,105,0.55)] active:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"

/** Ghost/secondary (navigation, toggle). */
export const btnGhost =
  "rounded-xl border border-white/[0.11] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/[0.08] hover:text-white"

/** Compact ghost control for small utility actions. */
export const btnGhostCompact =
  "rounded-lg border border-white/[0.11] bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-300 transition-all hover:bg-white/[0.08]"

// ── Feedback ──────────────────────────────────────────────────────────────────

/** Inline error banner. */
export const errorBanner =
  "rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-sm text-red-200 shadow-[0_8px_24px_rgba(127,29,29,0.2)]"

/** Link accent colour. */
export const linkAccent = "font-semibold text-violet-300 underline hover:text-violet-200"

/** Base pill for status indicators. */
export const statusPill =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.12em]"

/** Neutral pill. */
export const statusPillNeutral = "border-white/[0.12] bg-white/[0.06] text-slate-300"

/** Accent/violet pill. */
export const statusPillAccent = "border-violet-400/30 bg-violet-500/14 text-violet-200"

/** Success pill. */
export const statusPillSuccess = "border-emerald-400/30 bg-emerald-500/14 text-emerald-200"

/** Warning pill. */
export const statusPillWarning = "border-amber-400/30 bg-amber-500/14 text-amber-200"

/** Danger pill. */
export const statusPillDanger = "border-rose-400/30 bg-rose-500/14 text-rose-200"

// ── Overlay / HUD ─────────────────────────────────────────────────────────────

/** Semi-transparent scrim. */
export const overlayScrim =
  "absolute inset-0 z-40 flex flex-col items-center justify-center"

/** Inline style for the loading-gate background tint. */
export const overlayScrimStyle = { backgroundColor: "rgba(0,0,0,0.55)" } as const

/** Floating card inside an overlay. */
export const overlayCard =
  "flex flex-col items-center gap-4 rounded-2xl border border-white/[0.1] bg-[rgba(9,12,30,0.95)] px-10 py-8 shadow-[0_30px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl"

/** In-game HUD top-left panel (HP / lives / gold). */
export const hudTopPanel =
  "absolute left-4 top-4 flex flex-col gap-1 rounded-lg border border-white/[0.1] bg-black/60 px-3 py-2 text-sm text-white shadow-lg backdrop-blur-sm"
