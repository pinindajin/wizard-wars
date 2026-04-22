import Phaser from "phaser"

import type { PlayerInputPayload } from "@/shared/types"

/** Key bindings mapped to game actions. Configurable in future via GameKeybindConfig. */
const DEFAULT_BINDS = {
  up: [Phaser.Input.Keyboard.KeyCodes.W, Phaser.Input.Keyboard.KeyCodes.UP],
  down: [Phaser.Input.Keyboard.KeyCodes.S, Phaser.Input.Keyboard.KeyCodes.DOWN],
  left: [Phaser.Input.Keyboard.KeyCodes.A, Phaser.Input.Keyboard.KeyCodes.LEFT],
  right: [Phaser.Input.Keyboard.KeyCodes.D, Phaser.Input.Keyboard.KeyCodes.RIGHT],
  ability0: [Phaser.Input.Keyboard.KeyCodes.ONE],
  ability1: [Phaser.Input.Keyboard.KeyCodes.TWO],
  ability2: [Phaser.Input.Keyboard.KeyCodes.THREE],
  ability3: [Phaser.Input.Keyboard.KeyCodes.FOUR],
  ability4: [Phaser.Input.Keyboard.KeyCodes.FIVE],
  quickItem0: [Phaser.Input.Keyboard.KeyCodes.Q],
  quickItem1: [Phaser.Input.Keyboard.KeyCodes.E],
  quickItem2: [Phaser.Input.Keyboard.KeyCodes.R],
  quickItem3: [Phaser.Input.Keyboard.KeyCodes.F],
} as const

/** Tags for interactive HTML elements that should suppress game input. */
const INPUT_BLOCKING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])

/**
 * Reads Phaser keyboard state and composes the movement/ability portion of PlayerInputPayload.
 * Respects the Input Focus Lock rule: no input is sent while the browser focus is on a
 * text input, textarea, or contenteditable element.
 */
export class KeyboardController {
  private scene: Phaser.Scene
  private keys: Map<string, Phaser.Input.Keyboard.Key[]> = new Map()
  private _enabled = false

  /**
   * @param scene - The Arena scene instance.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this._registerKeys()
  }

  /**
   * Enables input collection. Call on MatchGo.
   */
  enable(): void {
    this._enabled = true
  }

  /**
   * Disables input collection (e.g. during countdown or scoreboard).
   */
  disable(): void {
    this._enabled = false
  }

  /**
   * Returns true if a text input or contenteditable element currently has focus,
   * meaning game keyboard input should be suppressed.
   */
  private _isUiInputFocused(): boolean {
    const el = document.activeElement
    if (!el) return false
    if (INPUT_BLOCKING_TAGS.has(el.tagName)) return true
    if ((el as HTMLElement).isContentEditable) return true
    return false
  }

  /**
   * Collects the current keyboard state and returns the movement + ability portion
   * of a PlayerInputPayload. Mouse-driven fields are filled in by MouseController.
   *
   * @param seq - The outbound sequence number for this tick.
   * @returns Partial PlayerInputPayload (movement + abilities; weapon fields defaulted to false/0).
   */
  collectInput(seq: number): Omit<PlayerInputPayload, "weaponPrimary" | "weaponSecondary" | "weaponTargetX" | "weaponTargetY"> {
    const inactive: Omit<PlayerInputPayload, "weaponPrimary" | "weaponSecondary" | "weaponTargetX" | "weaponTargetY"> = {
      up: false,
      down: false,
      left: false,
      right: false,
      abilitySlot: null,
      abilityTargetX: 0,
      abilityTargetY: 0,
      useQuickItemSlot: null,
      seq,
    }

    if (!this._enabled || this._isUiInputFocused()) return inactive

    const worldPointer = this.scene.input.activePointer.positionToCamera(
      this.scene.cameras.main,
    ) as Phaser.Math.Vector2

    const activeAbility = this._getFirstActiveAbilitySlot()
    const activeQuickItem = this._getFirstActiveQuickItemSlot()

    return {
      up: this._anyDown("up"),
      down: this._anyDown("down"),
      left: this._anyDown("left"),
      right: this._anyDown("right"),
      abilitySlot: activeAbility,
      abilityTargetX: worldPointer.x,
      abilityTargetY: worldPointer.y,
      useQuickItemSlot: activeQuickItem,
      seq,
    }
  }

  /**
   * Returns true if any bound key for the given action is currently held.
   *
   * @param action - Action name matching a key in DEFAULT_BINDS.
   */
  private _anyDown(action: keyof typeof DEFAULT_BINDS): boolean {
    const keys = this.keys.get(action)
    if (!keys) return false
    return keys.some((k) => k.isDown)
  }

  /**
   * Returns the 0-based index of the first ability slot key currently just-pressed, or null.
   */
  private _getFirstActiveAbilitySlot(): number | null {
    for (let i = 0; i < 5; i++) {
      const action = `ability${i}` as keyof typeof DEFAULT_BINDS
      const keys = this.keys.get(action)
      if (keys?.some((k) => Phaser.Input.Keyboard.JustDown(k))) return i
    }
    return null
  }

  /**
   * Returns the 0-based index of the first quick-item slot key currently just-pressed, or null.
   */
  private _getFirstActiveQuickItemSlot(): number | null {
    for (let i = 0; i < 4; i++) {
      const action = `quickItem${i}` as keyof typeof DEFAULT_BINDS
      const keys = this.keys.get(action)
      if (keys?.some((k) => Phaser.Input.Keyboard.JustDown(k))) return i
    }
    return null
  }

  /**
   * Registers all default keybind keys with the Phaser keyboard plugin.
   */
  private _registerKeys(): void {
    const keyboard = this.scene.input.keyboard
    if (!keyboard) return

    for (const [action, codes] of Object.entries(DEFAULT_BINDS)) {
      const mapped = (codes as readonly number[]).map((code) =>
        keyboard.addKey(code, false),
      )
      this.keys.set(action, mapped)
    }
  }
}
