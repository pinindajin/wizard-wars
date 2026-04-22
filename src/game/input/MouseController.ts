import Phaser from "phaser"

import type { PlayerInputPayload } from "@/shared/types"

/** Fields from PlayerInputPayload that the MouseController is responsible for. */
type MouseInputFields = Pick<
  PlayerInputPayload,
  "weaponPrimary" | "weaponSecondary" | "weaponTargetX" | "weaponTargetY"
>

/**
 * Reads Phaser pointer events and composes the weapon portion of PlayerInputPayload.
 * LMB fires weapon_primary (held = auto-repeat each tick).
 * RMB fires weapon_secondary (held = auto-repeat each tick).
 */
export class MouseController {
  private scene: Phaser.Scene
  private _enabled = false

  /**
   * @param scene - The Arena scene instance.
   */
  constructor(scene: Phaser.Scene) {
    this.scene = scene
  }

  /**
   * Enables mouse input collection. Call on MatchGo.
   */
  enable(): void {
    this._enabled = true
  }

  /**
   * Disables mouse input collection.
   */
  disable(): void {
    this._enabled = false
  }

  /**
   * Collects the current mouse state and returns the weapon portion of PlayerInputPayload.
   * Both LMB (primary) and RMB (secondary) are sampled as held-state so the caller
   * can auto-repeat at the desired cadence by calling this each tick.
   *
   * @returns MouseInputFields for merging into the full PlayerInputPayload.
   */
  collectInput(): MouseInputFields {
    const inactive: MouseInputFields = {
      weaponPrimary: false,
      weaponSecondary: false,
      weaponTargetX: 0,
      weaponTargetY: 0,
    }

    if (!this._enabled) return inactive

    const pointer = this.scene.input.activePointer
    const worldPos = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2

    return {
      weaponPrimary: pointer.leftButtonDown(),
      weaponSecondary: pointer.rightButtonDown(),
      weaponTargetX: worldPos.x,
      weaponTargetY: worldPos.y,
    }
  }
}
