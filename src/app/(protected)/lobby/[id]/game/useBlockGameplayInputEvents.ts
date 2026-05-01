"use client"

import type { DOMAttributes } from "react"

type GameplayInputBlockProps = Pick<
  DOMAttributes<HTMLElement>,
  | "onPointerDown"
  | "onPointerUp"
  | "onMouseDown"
  | "onMouseUp"
  | "onClick"
  | "onContextMenu"
  | "onKeyDown"
  | "onKeyUp"
>

/**
 * Returns capture handlers that keep modal events from reaching Phaser gameplay input.
 *
 * @returns React capture handlers for modal root elements.
 */
export function useBlockGameplayInputEvents(): GameplayInputBlockProps {
  return {
    onPointerDown: (e) => e.stopPropagation(),
    onPointerUp: (e) => e.stopPropagation(),
    onMouseDown: (e) => e.stopPropagation(),
    onMouseUp: (e) => e.stopPropagation(),
    onClick: (e) => e.stopPropagation(),
    onContextMenu: (e) => {
      e.preventDefault()
      e.stopPropagation()
    },
    onKeyDown: (e) => e.stopPropagation(),
    onKeyUp: (e) => e.stopPropagation(),
  }
}
