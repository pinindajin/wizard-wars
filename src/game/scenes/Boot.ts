import Phaser from "phaser"

/**
 * Boot scene: first scene to run.
 * Loads the boot asset pack (minimal loading screen assets) then hands off to Preload.
 * Compatible with Phaser Editor 2D via the editorCreate() pattern.
 */
export class Boot extends Phaser.Scene {
  constructor() {
    super({ key: "Boot" })
  }

  preload(): void {
    this.load.pack("boot-assets", "assets/boot-asset-pack.json")
  }

  create(): void {
    this.editorCreate()
  }

  /**
   * Phaser Editor 2D compatible creation method.
   * Transitions to the Preload scene after boot assets are ready.
   */
  editorCreate(): void {
    this.scene.start("Preload")
  }
}
