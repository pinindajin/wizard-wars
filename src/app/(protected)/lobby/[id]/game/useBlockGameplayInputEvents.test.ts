import { describe, expect, it, vi } from "vitest"

import { useBlockGameplayInputEvents } from "./useBlockGameplayInputEvents"

describe("useBlockGameplayInputEvents", () => {
  it("stops propagation for pointer, mouse, click, and key handlers", () => {
    const props = useBlockGameplayInputEvents()

    const mk = () => {
      const stopPropagation = vi.fn()
      const preventDefault = vi.fn()
      return { stopPropagation, preventDefault }
    }

    const ePointerDown = mk()
    props.onPointerDown?.(ePointerDown as never)
    expect(ePointerDown.stopPropagation).toHaveBeenCalledOnce()

    const ePointerUp = mk()
    props.onPointerUp?.(ePointerUp as never)
    expect(ePointerUp.stopPropagation).toHaveBeenCalledOnce()

    const eMouseDown = mk()
    props.onMouseDown?.(eMouseDown as never)
    expect(eMouseDown.stopPropagation).toHaveBeenCalledOnce()

    const eMouseUp = mk()
    props.onMouseUp?.(eMouseUp as never)
    expect(eMouseUp.stopPropagation).toHaveBeenCalledOnce()

    const eClick = mk()
    props.onClick?.(eClick as never)
    expect(eClick.stopPropagation).toHaveBeenCalledOnce()

    const eKeyDown = mk()
    props.onKeyDown?.(eKeyDown as never)
    expect(eKeyDown.stopPropagation).toHaveBeenCalledOnce()

    const eKeyUp = mk()
    props.onKeyUp?.(eKeyUp as never)
    expect(eKeyUp.stopPropagation).toHaveBeenCalledOnce()
  })

  it("prevents default and stops propagation on context menu", () => {
    const props = useBlockGameplayInputEvents()
    const stopPropagation = vi.fn()
    const preventDefault = vi.fn()
    props.onContextMenu?.({ stopPropagation, preventDefault } as never)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(stopPropagation).toHaveBeenCalledOnce()
  })
})
