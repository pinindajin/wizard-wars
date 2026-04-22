/**
 * Shared Tailwind class-string tokens for auth, global chat, pre-game lobby, and in-game
 * HUD chrome. Aligns Wizard Wars with the battle-click card+grid layout while keeping WW's
 * purple brand. Primary CTAs → purple; start/success → green; secondary actions → ghost.
 */

// ── Page shells ──────────────────────────────────────────────────────────────

/** Full-height dark background for the app; base for all page roots. */
export const pageShell = "min-h-screen bg-gray-900 text-white"

/** Auth pages: narrow centered column. */
export const authPage = `mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6`

/** Chat + lobby pages: max-width centered. */
export const lobbyPage = `mx-auto min-h-screen w-full max-w-4xl p-4 sm:p-6`

// ── Grid ─────────────────────────────────────────────────────────────────────

/** Responsive 3-column grid: 1 col on mobile, 3 on md+. */
export const gridThreeCols = "grid grid-cols-1 gap-6 md:grid-cols-3"

/** Chat panel spanning 2 of 3 columns. */
export const gridChatSpan = "flex flex-col md:col-span-2"

// ── Card panels ──────────────────────────────────────────────────────────────

/** Standard semi-transparent bordered card. */
export const cardPanel = "rounded-lg border border-gray-700 bg-gray-800/50 p-4 shadow-sm"

/** Opaque card for sidebars and auth forms. */
export const cardPanelOpaque = "rounded-lg border border-gray-700 bg-gray-800 p-4 shadow-sm"

/** Kicked/error state card. */
export const cardPanelKicked =
  "rounded-xl border border-red-600/60 bg-gray-800 p-8 text-center shadow-2xl"

// ── Typography ────────────────────────────────────────────────────────────────

/** Card/section heading. */
export const sectionTitle = "text-sm font-semibold text-gray-400"

/** All-caps smaller section label (e.g. "Select Hero"). */
export const sectionTitleCaps =
  "text-xs font-semibold uppercase tracking-wider text-gray-500"

/** Online-users strip label. */
export const onlineLabelClass = "font-medium text-gray-400"

/** Chat message sender name. */
export const messageName = "font-semibold text-purple-400"

/** Chat message body text. */
export const messageBody = "text-gray-200"

/** Separator colour in chat messages. */
export const messageSep = "text-gray-500"

/** Brand logo title. */
export const brandTitle = "text-3xl font-bold text-purple-400"

/** Brand subtitle / tagline. */
export const subBrand = "mt-1 text-xs text-gray-500"

// ── Inputs ────────────────────────────────────────────────────────────────────

/** Inline chat input (flex-1 sibling to Send button). */
export const inputChat =
  "flex-1 rounded-md border border-gray-600 bg-gray-900/80 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"

// ── Buttons ───────────────────────────────────────────────────────────────────

/** Purple primary action (inline, e.g. Send). */
export const btnPrimary =
  "rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 active:bg-purple-800 disabled:opacity-50"

/** Purple primary full-width (auth forms). */
export const btnPrimaryBlock =
  "w-full rounded-md bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 active:bg-purple-800 disabled:opacity-50"

/** Green success/start action, full-width. */
export const btnSuccessBlock =
  "w-full rounded-md bg-green-600 py-3 text-sm font-bold text-white hover:bg-green-700 active:bg-green-800 disabled:opacity-50"

/** Ghost/secondary (navigation, toggle). */
export const btnGhost =
  "rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-700/80"

// ── Feedback ──────────────────────────────────────────────────────────────────

/** Inline error banner. */
export const errorBanner =
  "rounded border border-red-500/80 bg-red-900/30 p-3 text-sm text-red-200"

/** Link accent colour. */
export const linkAccent = "text-purple-400 hover:underline"

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
