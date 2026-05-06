"use client"

import { useEffect, useMemo, useState } from "react"

import type { LobbyAdminClosingPayload } from "@/shared/types"
import { btnPrimary } from "@/lib/ui/lobbyStyles"

type AdminClosingModalProps = {
  readonly payload: LobbyAdminClosingPayload
  readonly onDone: () => void
}

function getRemainingSeconds(closeAtServerMs: number): number {
  return Math.max(0, Math.ceil((closeAtServerMs - Date.now()) / 1000))
}

/**
 * Blocking notice shown when an admin is closing the current lobby/game.
 */
export function AdminClosingModal({ payload, onDone }: AdminClosingModalProps) {
  const [remaining, setRemaining] = useState(() =>
    getRemainingSeconds(payload.closeAtServerMs),
  )

  useEffect(() => {
    const update = () => {
      const next = getRemainingSeconds(payload.closeAtServerMs)
      setRemaining(next)
      if (next <= 0) onDone()
    }
    update()
    const id = window.setInterval(update, 250)
    return () => window.clearInterval(id)
  }, [onDone, payload.closeAtServerMs])

  const label = useMemo(
    () => `${remaining} second${remaining === 1 ? "" : "s"}`,
    [remaining],
  )

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 px-6 text-center text-slate-100 backdrop-blur-sm"
      data-testid="admin-closing-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Admin closing lobby"
    >
      <div className="w-full max-w-md rounded-2xl border border-red-400/30 bg-slate-950 p-7 shadow-2xl shadow-red-950/40">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">
          Admin Closure
        </p>
        <h2 className="mt-3 text-2xl font-black tracking-tight text-white">
          Session Ending
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">{payload.message}</p>
        <p className="mt-6 font-mono text-4xl font-black text-red-200" data-testid="admin-closing-countdown">
          {label}
        </p>
        <button className={`${btnPrimary} mt-6 w-full`} type="button" onClick={onDone}>
          Return to Browser
        </button>
      </div>
    </div>
  )
}
