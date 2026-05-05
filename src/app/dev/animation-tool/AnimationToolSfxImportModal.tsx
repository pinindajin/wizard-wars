"use client"

import { useId, useRef, useState } from "react"

export type AnimationToolSfxImportModalProps = {
  readonly onClose: () => void
  readonly heroId: string
  readonly actionId: string
  readonly resolvedKey: string
  /** Human-readable destination, e.g. `public/assets/sounds/sfx-fireball-cast.mp3`. */
  readonly destinationPathLabel: string
  readonly busy: boolean
  readonly error: string | null
  /**
   * Persists the chosen MP3 to disk via the dev import route (multipart).
   *
   * @param file - User-selected MP3.
   */
  readonly onSubmit: (file: File) => void | Promise<void>
}

/**
 * Modal for importing a replacement MP3 for the resolved SFX key (read-only destination path).
 */
export function AnimationToolSfxImportModal(props: AnimationToolSfxImportModalProps) {
  const { onClose, heroId, actionId, resolvedKey, destinationPathLabel, busy, error, onSubmit } = props
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const confirmId = useId()

  const canSave = Boolean(file) && confirmed && !busy

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="animation-tool-sfx-import-title"
      data-testid="animation-tool-sfx-import-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-stone-600 bg-stone-900 p-5 shadow-2xl">
        <h2 id="animation-tool-sfx-import-title" className="font-mono text-lg text-stone-100">
          Replace sound asset
        </h2>
        <p className="mt-2 font-mono text-xs leading-relaxed text-stone-400">
          Destination is fixed to the resolved Phaser key for{" "}
          <span className="text-lime-200">{heroId}</span> /{" "}
          <span className="text-lime-200">{actionId}</span>. The previous file on disk (if any) is moved under your
          configured archive root before the new bytes are written.
        </p>
        <dl className="mt-3 space-y-1 font-mono text-[11px] text-stone-300">
          <div className="flex gap-2">
            <dt className="shrink-0 text-stone-500">Key</dt>
            <dd className="text-lime-200">{resolvedKey}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-stone-500">Path</dt>
            <dd className="break-all text-stone-200">{destinationPathLabel}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3"
            className="hidden"
            data-testid="animation-tool-sfx-import-file"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null
              setFile(next)
            }}
          />
          <button
            type="button"
            className="rounded-lg border border-stone-600 bg-stone-950 px-4 py-2 font-mono text-sm text-stone-200 hover:border-lime-600"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </button>
          {file ? (
            <p className="font-mono text-[11px] text-stone-400">
              Selected: <span className="text-stone-200">{file.name}</span> ({String(file.size)} bytes)
            </p>
          ) : (
            <p className="font-mono text-[11px] text-stone-500">No file selected.</p>
          )}
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 font-mono text-xs text-stone-300">
          <input
            id={confirmId}
            type="checkbox"
            checked={confirmed}
            className="mt-0.5"
            data-testid="animation-tool-sfx-import-confirm"
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I understand this replaces the on-disk asset for <strong className="text-stone-100">{resolvedKey}</strong>{" "}
            and archives the previous file (if one exists).
          </span>
        </label>

        {error ? (
          <p className="mt-3 rounded border border-red-700/60 bg-red-950/40 p-2 font-mono text-xs text-red-200">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-stone-600 px-4 py-2 font-mono text-sm text-stone-300 hover:bg-stone-800"
            disabled={busy}
            onClick={() => onClose()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-lime-500 px-4 py-2 font-mono text-sm font-bold text-stone-950 hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSave}
            data-testid="animation-tool-sfx-import-save"
            onClick={() => {
              if (!file) return
              void onSubmit(file)
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
