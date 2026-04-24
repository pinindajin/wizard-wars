import Phaser from "phaser"

import {
  DEFAULT_KEYBINDS,
  type KeybindConfig,
} from "@/shared/gameKeybinds/lobbyKeybinds"
import { WW_KEYBIND_CONFIG_REGISTRY_KEY } from "@/game/constants"
import type { PlayerInputPayload } from "@/shared/types"

import { keyStringToKeyCode } from "./keyStringToKeyCode"

/** How many input sends include a non-null ability slot after a key edge. */
const ARMED_ABILITY_FRAMES = 2

type ActionId =
  | "moveUp"
  | "moveDown"
  | "moveLeft"
  | "moveRight"
  | "ability0"
  | "ability1"
  | "ability2"
  | "ability3"
  | "ability4"
  | "quickItem0"
  | "quickItem1"
  | "quickItem2"
  | "quickItem3"

const ACTION_TO_KEYBIND: Record<ActionId, keyof KeybindConfig> = {
  moveUp: "move_up",
  moveDown: "move_down",
  moveLeft: "move_left",
  moveRight: "move_right",
  ability0: "ability_1",
  ability1: "ability_2",
  ability2: "ability_3",
  ability3: "ability_4",
  ability4: "ability_5",
  quickItem0: "quick_item_1",
  quickItem1: "quick_item_2",
  quickItem2: "quick_item_3",
  quickItem3: "quick_item_4",
}

/** Tags for interactive HTML elements that should suppress game input. */
const INPUT_BLOCKING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])

/**
 * Reads Phaser keyboard state and composes the movement/ability portion of PlayerInputPayload.
 * Respects the Input Focus Lock rule: no input is sent while the browser focus is on a
 * text input, textarea, or contenteditable element.
 */
export class KeyboardController {
  private scene: Phaser.Scene
  private keys = new Map<ActionId, Phaser.Input.Keyboard.Key[]>()
  private _enabled = false
  private _armedAbility: { slot: number; left: number } | null = null
  private _armedQuick: { slot: number; left: number } | null = null

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

  private _getKeybinds(): KeybindConfig {
    const fromRegistry = this.scene.game.registry.get(
      WW_KEYBIND_CONFIG_REGISTRY_KEY,
    ) as KeybindConfig | undefined
    return fromRegistry ?? DEFAULT_KEYBINDS
  }

  /**
   * Collects the current keyboard state and returns the movement + ability portion
   * of a PlayerInputPayload. Mouse-driven fields are filled in by MouseController
   * and `clientSendTimeMs` is stamped by `Arena.update` right before send to
   * keep this controller oblivious to wall-clock time (testability).
   *
   * @param seq - The outbound sequence number for this tick.
   * @returns Partial PlayerInputPayload (movement + abilities; weapon fields +
   *   clientSendTimeMs are filled by callers).
   */
  collectInput(seq: number): Omit<
    PlayerInputPayload,
    | "weaponPrimary"
    | "weaponSecondary"
    | "weaponTargetX"
    | "weaponTargetY"
    | "clientSendTimeMs"
  > {
    const inactive: Omit<
      PlayerInputPayload,
      | "weaponPrimary"
      | "weaponSecondary"
      | "weaponTargetX"
      | "weaponTargetY"
      | "clientSendTimeMs"
    > = {
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

    if (!this._enabled || this._isUiInputFocused()) {
      this._armedAbility = null
      this._armedQuick = null
      return inactive
    }

    this._rearmFromJustDown()

    const worldPointer = this.scene.input.activePointer.positionToCamera(
      this.scene.cameras.main,
    ) as Phaser.Math.Vector2

    let abilitySlot: number | null = null
    if (this._armedAbility && this._armedAbility.left > 0) {
      abilitySlot = this._armedAbility.slot
      this._armedAbility.left -= 1
      if (this._armedAbility.left <= 0) {
        this._armedAbility = null
      }
    }

    let useQuickItemSlot: number | null = null
    if (this._armedQuick && this._armedQuick.left > 0) {
      useQuickItemSlot = this._armedQuick.slot
      this._armedQuick.left -= 1
      if (this._armedQuick.left <= 0) {
        this._armedQuick = null
      }
    }

    return {
      up: this._anyDown("moveUp"),
      down: this._anyDown("moveDown"),
      left: this._anyDown("moveLeft"),
      right: this._anyDown("moveRight"),
      abilitySlot,
      abilityTargetX: worldPointer.x,
      abilityTargetY: worldPointer.y,
      useQuickItemSlot,
      seq,
    }
  }

  private _rearmFromJustDown(): void {
    const abilityActions: ActionId[] = [
      "ability0", "ability1", "ability2", "ability3", "ability4",
    ]
    for (let i = 0; i < 5; i++) {
      if (this._anyJustDown(abilityActions[i]!)) {
        this._armedAbility = { slot: i, left: ARMED_ABILITY_FRAMES }
        break
      }
    }
    const quickActions: ActionId[] = [
      "quickItem0", "quickItem1", "quickItem2", "quickItem3",
    ]
    for (let i = 0; i < 4; i++) {
      if (this._anyJustDown(quickActions[i]!)) {
        this._armedQuick = { slot: i, left: ARMED_ABILITY_FRAMES }
        break
      }
    }
  }

  private _anyDown(action: ActionId): boolean {
    const list = this.keys.get(action)
    if (!list) return false
    return list.some((k) => k.isDown)
  }

  private _anyJustDown(action: ActionId): boolean {
    const list = this.keys.get(action)
    if (!list) return false
    return list.some((k) => Phaser.Input.Keyboard.JustDown(k))
  }

  private _registerKeys(): void {
    const keyboard = this.scene.input.keyboard
    if (!keyboard) return
    const cfg = this._getKeybinds()

    for (const [action, bindId] of Object.entries(
      ACTION_TO_KEYBIND,
    ) as [ActionId, keyof KeybindConfig][]) {
      const s = cfg[bindId] ?? DEFAULT_KEYBINDS[bindId]
      const code = keyStringToKeyCode(s)
      if (code == null) continue
      const k = keyboard.addKey(code, false, false)
      const prev = this.keys.get(action) ?? []
      this.keys.set(action, [...prev, k])
    }
  }
}
