import Phaser from "phaser"

const BAR_WIDTH = 320
const BAR_HEIGHT = 32
const BAR_COLOR_BG = 0x222244
const BAR_COLOR_FILL = 0x7766ee

/**
 * Preload scene: loads the full preload asset pack while displaying a progress bar,
 * then transitions to the Arena scene.
 * Compatible with Phaser Editor 2D via the editorCreate() pattern.
 */
export class Preload extends Phaser.Scene {
  private progressBar!: Phaser.GameObjects.Graphics
  private progressBox!: Phaser.GameObjects.Graphics
  private loadingText!: Phaser.GameObjects.Text

  constructor() {
    super({ key: "Preload" })
  }

  preload(): void {
    this.editorCreate()
    this.load.pack("preload-assets", "assets/packs/preload-asset-pack.json")

    this.load.on("progress", (value: number) => {
      this.progressBar.clear()
      this.progressBar.fillStyle(BAR_COLOR_FILL, 1)
      this.progressBar.fillRect(
        this.scale.width / 2 - BAR_WIDTH / 2 + 4,
        this.scale.height / 2 - BAR_HEIGHT / 2 + 4,
        (BAR_WIDTH - 8) * value,
        BAR_HEIGHT - 8,
      )
      this.loadingText.setText(`Loading… ${Math.round(value * 100)}%`)
    })

    this.load.on("complete", () => {
      this.progressBar.destroy()
      this.progressBox.destroy()
      this.loadingText.destroy()
    })
  }

  create(): void {
    this.scene.start("Arena")
  }

  /**
   * Phaser Editor 2D compatible creation method.
   * Builds the loading bar UI elements used during preload.
   */
  editorCreate(): void {
    const cx = this.scale.width / 2
    const cy = this.scale.height / 2

    this.progressBox = this.add.graphics()
    this.progressBox.fillStyle(BAR_COLOR_BG, 0.9)
    this.progressBox.fillRect(cx - BAR_WIDTH / 2, cy - BAR_HEIGHT / 2, BAR_WIDTH, BAR_HEIGHT)

    this.progressBar = this.add.graphics()

    this.loadingText = this.add
      .text(cx, cy - BAR_HEIGHT, "Loading…", {
        fontSize: "18px",
        color: "#ccccff",
        fontFamily: "monospace",
      })
      .setOrigin(0.5, 1)
  }
}
