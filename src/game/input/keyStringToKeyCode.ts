import Phaser from "phaser"

const KEY = Phaser.Input.Keyboard.KeyCodes

/**
 * Maps a key string from the lobby keybind config (lowercase key / Tab / \ / digits)
 * to a Phaser key code. Returns null for mouse or unknown codes.
 */
export function keyStringToKeyCode(key: string): number | null {
  const t = key.trim()
  if (t === "MouseLeft" || t === "MouseRight" || t === "") {
    return null
  }
  if (t === "Tab") return KEY.TAB
  if (t === "\\" || t === "Backslash") return KEY.BACK_SLASH
  if (t === " " || t === "Space") return KEY.SPACE
  if (t === "Shift") return KEY.SHIFT
  if (t === "Control" || t === "Ctrl") return KEY.CTRL
  if (t === "Alt") return KEY.ALT
  if (t === "ArrowUp") return KEY.UP
  if (t === "ArrowDown") return KEY.DOWN
  if (t === "ArrowLeft") return KEY.LEFT
  if (t === "ArrowRight") return KEY.RIGHT

  if (t.length === 1) {
    const c = t.toLowerCase()
    if (c >= "a" && c <= "z") {
      return [KEY.A, KEY.B, KEY.C, KEY.D, KEY.E, KEY.F, KEY.G, KEY.H, KEY.I, KEY.J, KEY.K, KEY.L, KEY.M, KEY.N, KEY.O, KEY.P, KEY.Q, KEY.R, KEY.S, KEY.T, KEY.U, KEY.V, KEY.W, KEY.X, KEY.Y, KEY.Z][c.charCodeAt(0) - 97]!
    }
    if (c >= "0" && c <= "9") {
      const n = c.charCodeAt(0) - 48
      return [KEY.ZERO, KEY.ONE, KEY.TWO, KEY.THREE, KEY.FOUR, KEY.FIVE, KEY.SIX, KEY.SEVEN, KEY.EIGHT, KEY.NINE][n]!
    }
  }

  return null
}
