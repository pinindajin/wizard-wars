import Phaser from "phaser"

import { DEFAULT_KEYBINDS, type KeybindConfig } from "@/shared/gameKeybinds/lobbyKeybinds"
import {
  parseMinimapCorner,
  type MinimapCorner,
} from "@/shared/settings-config"
import {
  WW_GAMEPLAY_INPUT_BLOCKED_REGISTRY_KEY,
  WW_KEYBIND_CONFIG_REGISTRY_KEY,
  WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
  WW_MINIMAP_CORNER_REGISTRY_KEY,
} from "../constants"
import { ClientPlayerState, ClientRenderPos } from "../ecs/components"
import { computeMinimapViewport, type MinimapMode } from "./layout"

const MINIMAP_DEPTH = 100_000
const LOCAL_COLOR = 0x5eead4
const REMOTE_COLOR = 0xfbbf24

type PlayerMarker = {
  readonly dot: Phaser.GameObjects.Ellipse
  readonly ring: Phaser.GameObjects.Ellipse
}

function isUiInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el as HTMLElement).isContentEditable
  )
}

function eventKey(e: KeyboardEvent): string {
  if (e.key === " ") return "Space"
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

function bindKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/**
 * Phaser-owned minimap: a second camera plus world-space player markers.
 * DOM frame exists only for border/testability and never handles pointer input.
 */
export class MinimapController {
  private readonly camera: Phaser.Cameras.Scene2D.Camera
  private readonly markers = new Map<number, PlayerMarker>()
  private readonly frameEl: HTMLDivElement | null
  private corner: MinimapCorner
  private mode: MinimapMode = "compact"

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (this.isGameplayInputBlocked() || isUiInputFocused()) return
    const keybinds = this.scene.game.registry.get(
      WW_KEYBIND_CONFIG_REGISTRY_KEY,
    ) as KeybindConfig | undefined
    const toggleKey = keybinds?.toggle_minimap ?? DEFAULT_KEYBINDS.toggle_minimap
    if (eventKey(e) !== bindKey(toggleKey)) return

    this.mode = this.mode === "compact" ? "expanded" : "compact"
    this.applyLayout()
  }

  private readonly onResize = () => {
    this.applyLayout()
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly arenaMap: Phaser.Tilemaps.Tilemap,
  ) {
    this.corner = parseMinimapCorner(
      this.scene.game.registry.get(WW_MINIMAP_CORNER_REGISTRY_KEY),
    )
    const viewport = this.currentViewport()
    this.camera = this.scene.cameras.add(
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    )
    this.camera.setBackgroundColor("rgba(7, 10, 18, 0.82)")
    this.camera.setBounds(0, 0, this.arenaMap.widthInPixels, this.arenaMap.heightInPixels)
    this.camera.centerOn(this.arenaMap.widthInPixels / 2, this.arenaMap.heightInPixels / 2)
    this.camera.setRoundPixels(false)

    this.frameEl = this.createFrameElement()
    this.applyLayout()
    window.addEventListener("keydown", this.onKeyDown, { capture: true })
    window.addEventListener("resize", this.onResize)
  }

  setCorner(corner: MinimapCorner): void {
    this.corner = corner
    this.applyLayout()
  }

  update(): void {
    const keep = new Set<number>()
    const localPlayerId = this.scene.game.registry.get(
      WW_LOCAL_PLAYER_ID_REGISTRY_KEY,
    ) as string | undefined

    for (const [idStr, state] of Object.entries(ClientPlayerState)) {
      const id = Number(idStr)
      const pos = ClientRenderPos[id]
      if (!pos) continue
      keep.add(id)
      const isLocal = state.playerId === localPlayerId
      const marker = this.ensureMarker(id, isLocal)
      marker.dot.setPosition(pos.x, pos.y)
      marker.ring.setPosition(pos.x, pos.y)
      marker.ring.setVisible(isLocal)
    }

    for (const id of [...this.markers.keys()]) {
      if (!keep.has(id)) this.removeMarker(id)
    }
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown, { capture: true })
    window.removeEventListener("resize", this.onResize)
    for (const id of [...this.markers.keys()]) {
      this.removeMarker(id)
    }
    this.frameEl?.remove()
    this.scene.cameras.remove(this.camera)
  }

  private isGameplayInputBlocked(): boolean {
    return this.scene.game.registry.get(WW_GAMEPLAY_INPUT_BLOCKED_REGISTRY_KEY) === true
  }

  private ensureMarker(id: number, isLocal: boolean): PlayerMarker {
    const existing = this.markers.get(id)
    if (existing) {
      existing.dot.setFillStyle(isLocal ? LOCAL_COLOR : REMOTE_COLOR, 1)
      return existing
    }

    const dot = this.scene.add.ellipse(0, 0, 90, 90, isLocal ? LOCAL_COLOR : REMOTE_COLOR, 1)
    dot.setDepth(MINIMAP_DEPTH)
    const ring = this.scene.add.ellipse(0, 0, 150, 150)
    ring.setStrokeStyle(24, 0xffffff, 0.95)
    ring.setDepth(MINIMAP_DEPTH + 1)
    this.scene.cameras.main.ignore([dot, ring])

    const marker = { dot, ring }
    this.markers.set(id, marker)
    return marker
  }

  private removeMarker(id: number): void {
    const marker = this.markers.get(id)
    if (!marker) return
    marker.dot.destroy()
    marker.ring.destroy()
    this.markers.delete(id)
  }

  private currentViewport() {
    return computeMinimapViewport({
      canvasWidth: this.scene.scale.gameSize.width,
      canvasHeight: this.scene.scale.gameSize.height,
      arenaWidth: this.arenaMap.widthInPixels,
      arenaHeight: this.arenaMap.heightInPixels,
      corner: this.corner,
      mode: this.mode,
    })
  }

  private applyLayout(): void {
    const viewport = this.currentViewport()
    this.camera.setViewport(viewport.x, viewport.y, viewport.width, viewport.height)
    this.camera.setZoom(
      Math.min(
        viewport.width / this.arenaMap.widthInPixels,
        viewport.height / this.arenaMap.heightInPixels,
      ),
    )
    this.camera.centerOn(this.arenaMap.widthInPixels / 2, this.arenaMap.heightInPixels / 2)
    this.updateFrameElement(viewport)
  }

  private createFrameElement(): HTMLDivElement | null {
    const canvas = this.scene.game.canvas
    const parent = canvas.parentElement
    if (!parent) return null
    const frame = document.createElement("div")
    frame.dataset.testid = "game-minimap"
    frame.style.position = "absolute"
    frame.style.pointerEvents = "none"
    frame.style.boxSizing = "border-box"
    frame.style.border = "2px solid rgba(229, 231, 235, 0.82)"
    frame.style.background = "rgba(7, 10, 18, 0.18)"
    frame.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.38)"
    frame.style.zIndex = "35"
    parent.appendChild(frame)
    return frame
  }

  private updateFrameElement(viewport: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }): void {
    if (!this.frameEl) return
    const canvasRect = this.scene.game.canvas.getBoundingClientRect()
    const parentRect = this.scene.game.canvas.parentElement?.getBoundingClientRect()
    if (!parentRect) return
    const scaleX = canvasRect.width / this.scene.scale.gameSize.width
    const scaleY = canvasRect.height / this.scene.scale.gameSize.height
    this.frameEl.style.left = `${canvasRect.left - parentRect.left + viewport.x * scaleX}px`
    this.frameEl.style.top = `${canvasRect.top - parentRect.top + viewport.y * scaleY}px`
    this.frameEl.style.width = `${viewport.width * scaleX}px`
    this.frameEl.style.height = `${viewport.height * scaleY}px`
    this.frameEl.dataset.mode = this.mode
    this.frameEl.dataset.corner = this.corner
  }
}
