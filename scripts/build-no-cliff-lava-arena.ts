import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import sharp from "sharp"

import { simplifyRectCover } from "./rect-cover-simplification"

type RawImage = {
  readonly data: Buffer
  readonly width: number
  readonly height: number
}

type Rect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type PropInstance = Rect & {
  readonly id: string
  readonly key: string
  readonly fileName: string
  readonly x: number
  readonly y: number
}

type SpawnPoint = {
  readonly x: number
  readonly y: number
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, "..")
const REVIEW_DIR = resolve(ROOT, "public/assets/arena-review/no-cliff-lava")
const SOURCE_DIR = resolve(REVIEW_DIR, "source-images")
const GENERATED_REVIEW_DIR = resolve(REVIEW_DIR, "generated")
const PROP_DIR = resolve(ROOT, "public/assets/sprites/arena-props")
const MAP_DIR = resolve(ROOT, "public/assets/maps")
const BASE_OUT = resolve(MAP_DIR, "arena-base.png")

const OBSTACLE_SHEET = resolve(SOURCE_DIR, "obstacle-sheet.png")
const NO_BG_WITH_OBSTACLES = resolve(SOURCE_DIR, "map-no-bg-with-obstacles.png")
const NO_BG_NO_OBSTACLES = resolve(SOURCE_DIR, "map-no-bg-no-obstacles.png")
const LAVA_WITH_OBSTACLES = resolve(SOURCE_DIR, "map-lava-with-obstacles.png")
const LAVA_NO_OBSTACLES = resolve(SOURCE_DIR, "map-lava-no-obstacles.png")

const TILE_SIZE_PX = 64
const REGION_CELL_PX = 16
const PROP_DIFF_THRESHOLD = 18
const PROP_DILATE_RADIUS = 5
const MIN_PROP_MASK_AREA_PX = 80
const MIN_PROP_BBOX_SIZE_PX = 8
const SPAWN_SCAN_STEP_PX = 8
const SPAWN_SCAN_MAX_RADIUS_PX = 720

const PREFERRED_SPAWNS: readonly SpawnPoint[] = [
  { x: 2112, y: 1696 },
  { x: 1808, y: 1696 },
  { x: 2416, y: 1696 },
  { x: 2112, y: 1392 },
  { x: 2112, y: 1992 },
  { x: 1744, y: 1448 },
  { x: 2480, y: 1448 },
  { x: 1744, y: 1944 },
  { x: 2480, y: 1944 },
  { x: 920, y: 520 },
  { x: 3120, y: 520 },
  { x: 660, y: 1584 },
  { x: 760, y: 2816 },
  { x: 2144, y: 2936 },
  { x: 3264, y: 2688 },
  { x: 3512, y: 1888 },
]

function repoPath(path: string): string {
  return relative(ROOT, path).replace(/\\/g, "/")
}

async function loadRaw(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

function assertSameDimensions(images: readonly RawImage[]): void {
  const first = images[0]
  if (!first) throw new Error("Expected at least one image")
  for (const image of images) {
    if (image.width !== first.width || image.height !== first.height) {
      throw new Error(`Arena source images must share dimensions ${first.width}x${first.height}`)
    }
  }
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4
}

function alphaAt(image: RawImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0
  return image.data[pixelOffset(image.width, x, y) + 3] ?? 0
}

function isWalkablePixel(walkable: RawImage, x: number, y: number): boolean {
  return alphaAt(walkable, Math.round(x), Math.round(y)) > 0
}

function createPropDiffMask(withProps: RawImage, withoutProps: RawImage): Uint8Array {
  assertSameDimensions([withProps, withoutProps])
  const mask = new Uint8Array(withProps.width * withProps.height)
  for (let y = 0; y < withProps.height; y++) {
    for (let x = 0; x < withProps.width; x++) {
      const i = pixelOffset(withProps.width, x, y)
      const da = Math.abs((withProps.data[i + 3] ?? 0) - (withoutProps.data[i + 3] ?? 0))
      const dr = Math.abs((withProps.data[i] ?? 0) - (withoutProps.data[i] ?? 0))
      const dg = Math.abs((withProps.data[i + 1] ?? 0) - (withoutProps.data[i + 1] ?? 0))
      const db = Math.abs((withProps.data[i + 2] ?? 0) - (withoutProps.data[i + 2] ?? 0))
      if (da > 0 || dr + dg + db > PROP_DIFF_THRESHOLD) {
        mask[y * withProps.width + x] = 1
      }
    }
  }
  return dilateMask(mask, withProps.width, withProps.height, PROP_DILATE_RADIUS)
}

function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(height - 1, y + radius)
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width - 1, x + radius)
      for (let yy = y0; yy <= y1; yy++) {
        out.fill(1, yy * width + x0, yy * width + x1 + 1)
      }
    }
  }
  return out
}

function connectedComponents(mask: Uint8Array, width: number, height: number): Rect[] {
  const visited = new Uint8Array(mask.length)
  const queue = new Int32Array(mask.length)
  const rects: Rect[] = []

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || visited[start] === 1) continue

    let head = 0
    let tail = 0
    queue[tail++] = start
    visited[start] = 1

    let area = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0

    while (head < tail) {
      const index = queue[head++]!
      const x = index % width
      const y = Math.floor(index / width)
      area++
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      for (const next of [index - 1, index + 1, index - width, index + width]) {
        if (next < 0 || next >= mask.length) continue
        if ((next === index - 1 || next === index + 1) && Math.floor(next / width) !== y) continue
        if (mask[next] === 0 || visited[next] === 1) continue
        visited[next] = 1
        queue[tail++] = next
      }
    }

    const rect = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    }
    if (
      area >= MIN_PROP_MASK_AREA_PX &&
      rect.width >= MIN_PROP_BBOX_SIZE_PX &&
      rect.height >= MIN_PROP_BBOX_SIZE_PX
    ) {
      rects.push(rect)
    }
  }

  return rects.sort((a, b) => a.y - b.y || a.x - b.x)
}

function padRect(rect: Rect, width: number, height: number, padding: number): Rect {
  const x = Math.max(0, rect.x - padding)
  const y = Math.max(0, rect.y - padding)
  const right = Math.min(width, rect.x + rect.width + padding)
  const bottom = Math.min(height, rect.y + rect.height + padding)
  return { x, y, width: right - x, height: bottom - y }
}

async function writeMaskImage(
  mask: Uint8Array,
  width: number,
  height: number,
  path: string,
  color: { readonly r: number; readonly g: number; readonly b: number },
): Promise<void> {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue
    const offset = i * 4
    data[offset] = color.r
    data[offset + 1] = color.g
    data[offset + 2] = color.b
    data[offset + 3] = 255
  }
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(path)
}

async function extractPropInstances(withProps: RawImage, propMask: Uint8Array): Promise<PropInstance[]> {
  rmSync(PROP_DIR, { recursive: true, force: true })
  mkdirSync(PROP_DIR, { recursive: true })

  const components = connectedComponents(propMask, withProps.width, withProps.height)
  const props: PropInstance[] = []

  for (let i = 0; i < components.length; i++) {
    const source = padRect(components[i]!, withProps.width, withProps.height, 4)
    const crop = Buffer.alloc(source.width * source.height * 4)
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const sx = source.x + x
        const sy = source.y + y
        if (propMask[sy * withProps.width + sx] === 0) continue
        const src = pixelOffset(withProps.width, sx, sy)
        const dst = pixelOffset(source.width, x, y)
        crop[dst] = withProps.data[src] ?? 0
        crop[dst + 1] = withProps.data[src + 1] ?? 0
        crop[dst + 2] = withProps.data[src + 2] ?? 0
        crop[dst + 3] = withProps.data[src + 3] ?? 0
      }
    }

    const id = `instance-${String(i).padStart(3, "0")}`
    const fileName = `${id}.png`
    await sharp(crop, { raw: { width: source.width, height: source.height, channels: 4 } })
      .png()
      .toFile(resolve(PROP_DIR, fileName))

    props.push({
      id,
      key: `arena-prop-${id}`,
      fileName,
      x: source.x + source.width / 2,
      y: source.y + source.height,
      width: source.width,
      height: source.height,
    })
  }

  return props
}

function rectsFromCellMask(
  width: number,
  height: number,
  cellPx: number,
  occupied: (centerX: number, centerY: number) => boolean,
): Rect[] {
  const cols = Math.ceil(width / cellPx)
  const rows = Math.ceil(height / cellPx)
  const cells = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.min(width - 1, col * cellPx + cellPx / 2)
      const y = Math.min(height - 1, row * cellPx + cellPx / 2)
      cells[row * cols + col] = occupied(x, y) ? 1 : 0
    }
  }

  const runs: Rect[] = []
  for (let row = 0; row < rows; row++) {
    let col = 0
    while (col < cols) {
      if (cells[row * cols + col] === 0) {
        col++
        continue
      }
      const start = col
      while (col < cols && cells[row * cols + col] === 1) col++
      runs.push({
        x: start * cellPx,
        y: row * cellPx,
        width: Math.min(width, col * cellPx) - start * cellPx,
        height: Math.min(height, (row + 1) * cellPx) - row * cellPx,
      })
    }
  }

  return simplifyRectCover(runs)
}

function propColliderFor(prop: PropInstance): Rect & { readonly name: string } {
  const colliderWidth = Math.max(14, Math.round(prop.width * 0.62))
  const colliderHeight = Math.max(
    10,
    Math.min(44, Math.round(prop.height <= 70 ? prop.height * 0.42 : prop.height * 0.18)),
  )
  return {
    name: `propCollider_${prop.id.replace("instance-", "")}`,
    x: Math.round(prop.x - colliderWidth / 2),
    y: Math.round(prop.y - colliderHeight - 2),
    width: colliderWidth,
    height: colliderHeight,
  }
}

function ellipseOverlapsRect(
  point: SpawnPoint,
  rect: Rect,
  footprint = { radiusX: 18, radiusY: 10, offsetY: 8 },
): boolean {
  const nearestX = Math.max(rect.x, Math.min(point.x, rect.x + rect.width))
  const centerY = point.y + footprint.offsetY
  const nearestY = Math.max(rect.y, Math.min(centerY, rect.y + rect.height))
  const dx = (point.x - nearestX) / footprint.radiusX
  const dy = (centerY - nearestY) / footprint.radiusY
  return dx * dx + dy * dy < 1
}

function canUseSpawn(point: SpawnPoint, walkable: RawImage, propColliders: readonly Rect[]): boolean {
  if (point.x < 32 || point.y < 32 || point.x > walkable.width - 32 || point.y > walkable.height - 32) {
    return false
  }
  const samples = [
    point,
    { x: point.x - 18, y: point.y + 8 },
    { x: point.x + 18, y: point.y + 8 },
    { x: point.x, y: point.y - 12 },
    { x: point.x, y: point.y + 18 },
  ]
  if (!samples.every((sample) => isWalkablePixel(walkable, sample.x, sample.y))) {
    return false
  }
  return !propColliders.some((rect) => ellipseOverlapsRect(point, rect))
}

function snapSpawn(
  preferred: SpawnPoint,
  walkable: RawImage,
  propColliders: readonly Rect[],
  used: readonly SpawnPoint[],
): SpawnPoint {
  let best: { point: SpawnPoint; distSq: number } | null = null
  for (let radius = 0; radius <= SPAWN_SCAN_MAX_RADIUS_PX; radius += SPAWN_SCAN_STEP_PX) {
    for (let dy = -radius; dy <= radius; dy += SPAWN_SCAN_STEP_PX) {
      for (let dx = -radius; dx <= radius; dx += SPAWN_SCAN_STEP_PX) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
        const point = {
          x: Math.round((preferred.x + dx) / SPAWN_SCAN_STEP_PX) * SPAWN_SCAN_STEP_PX,
          y: Math.round((preferred.y + dy) / SPAWN_SCAN_STEP_PX) * SPAWN_SCAN_STEP_PX,
        }
        if (!canUseSpawn(point, walkable, propColliders)) continue
        if (used.some((other) => (other.x - point.x) ** 2 + (other.y - point.y) ** 2 < 96 ** 2)) {
          continue
        }
        const distSq = (point.x - preferred.x) ** 2 + (point.y - preferred.y) ** 2
        if (!best || distSq < best.distSq) best = { point, distSq }
      }
    }
    if (best) return best.point
  }
  throw new Error(`Could not place spawn near ${preferred.x},${preferred.y}`)
}

function buildSpawnPoints(walkable: RawImage, propColliders: readonly Rect[]): SpawnPoint[] {
  const spawns: SpawnPoint[] = []
  for (const preferred of PREFERRED_SPAWNS) {
    spawns.push(snapSpawn(preferred, walkable, propColliders, spawns))
    if (spawns.length === 12) break
  }
  return spawns
}

function rectangleSceneObject(
  id: string,
  label: string,
  rect: Rect,
  fillColor: number,
): Record<string, unknown> {
  return {
    type: "Rectangle",
    id,
    label,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    originX: 0,
    originY: 0,
    fillColor,
    fillAlpha: 0.25,
    isFilled: true,
    strokeColor: 0xffffff,
    strokeAlpha: 0.9,
    strokeWidth: 2,
    isStroked: true,
    visible: true,
    codexRuntimeExcluded: true,
  }
}

function writeArenaScene(
  width: number,
  height: number,
  props: readonly PropInstance[],
  propColliders: readonly (Rect & { readonly name: string })[],
  lavaRects: readonly Rect[],
  nonWalkableRects: readonly Rect[],
  walkableRects: readonly Rect[],
): void {
  const displayList: Record<string, unknown>[] = [
    {
      type: "Image",
      id: "arena_base",
      label: "arena_base",
      texture: { key: "arena-base" },
      x: 0,
      y: 0,
      originX: 0,
      originY: 0,
    },
  ]

  for (let i = 0; i < props.length; i++) {
    const prop = props[i]!
    displayList.push({
      type: "Image",
      id: `arena_prop_${String(i).padStart(3, "0")}`,
      label: `arena_prop_${String(i).padStart(3, "0")}_${prop.id}`,
      texture: { key: prop.key },
      x: prop.x,
      y: prop.y,
      originX: 0.5,
      originY: 1,
      scaleX: 1,
      scaleY: 1,
    })
  }

  for (const rect of propColliders) {
    displayList.push(rectangleSceneObject(rect.name, rect.name, rect, 0xffff00))
  }
  for (let i = 0; i < lavaRects.length; i++) {
    const label = `lavaArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, lavaRects[i]!, 0xff3c00))
  }
  for (let i = 0; i < nonWalkableRects.length; i++) {
    const label = `nonWalkableArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, nonWalkableRects[i]!, 0xff0000))
  }
  for (let i = 0; i < walkableRects.length; i++) {
    const label = `walkableArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, walkableRects[i]!, 0x50ff78))
  }

  writeFileSync(
    resolve(ROOT, "src/game/scenes/Arena.scene"),
    `${JSON.stringify(
      {
        id: "arena-scene",
        sceneType: "SCENE",
        settings: {
          exportClass: false,
          autoImport: true,
          preloadPackFiles: [],
          createMethodName: "editorCreate",
          sceneKey: "Arena",
          compilerOutputLanguage: "TYPE_SCRIPT",
          borderWidth: width,
          borderHeight: height,
        },
        displayList,
        plainObjects: [],
        meta: {
          app: "Phaser Editor - Scene Editor",
          url: "https://phaser.io/editor",
          contentType: "phasereditor2d.core.scene.SceneContentType",
          version: 5,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

function writeArenaRuntime(props: readonly PropInstance[]): void {
  const propCreateLines = props
    .map((prop, index) => {
      const varName = `arenaProp${index}`
      return `\n\t\t// ${varName}\n\t\tconst ${varName} = this.add.image(${prop.x}, ${prop.y}, "${prop.key}");\n\t\t${varName}.setOrigin(0.5, 1);\n\t\t${varName}.setDepth(${prop.y});\n\t\tthis.arenaProps.push(${varName});`
    })
    .join("\n")

  writeFileSync(
    resolve(ROOT, "src/game/scenes/Arena.ts"),
    `// You can write more code here\n\n/* START OF COMPILED CODE */\n\n/* START-USER-IMPORTS */\nimport Phaser from "phaser"\n\nimport { ARENA_HEIGHT, ARENA_WIDTH } from "@/shared/balance-config/arena"\nimport { TILEMAP_DEPTH } from "@/shared/balance-config/rendering"\nimport type { MinimapCorner } from "@/shared/settings-config"\nimport { WW_LOCAL_PLAYER_ID_REGISTRY_KEY } from "../constants"\nimport { GameConnection } from "../network/GameConnection"\nimport { PlayerRenderSystem } from "../ecs/systems/PlayerRenderSystem"\nimport {\n  publishLoaderComplete,\n  wireSceneLoaderProgress,\n} from "../loaderStatus"\nimport { ArenaRuntime } from "./ArenaRuntime"\n/* END-USER-IMPORTS */\n\nexport default class Arena extends Phaser.Scene {\n\n\tconstructor() {\n\t\tsuper("Arena");\n\n\t\t/* START-USER-CTR-CODE */\n\t\t/* END-USER-CTR-CODE */\n\t}\n\n\teditorCreate(): void {\n\t\t// Arena.scene is a Phaser Editor data scene: it keeps editor-visible\n\t\t// rectangles for regions/colliders, but this runtime output only creates\n\t\t// the visual image layer and props. Region data is exported via arena.json.\n\n\t\t// arena_base\n\t\tconst arenaBase = this.add.image(0, 0, "arena-base");\n\t\tarenaBase.setOrigin(0, 0);\n\t\tarenaBase.setDepth(TILEMAP_DEPTH);\n${propCreateLines}\n\n\t\tthis.arenaWidthPx = ARENA_WIDTH;\n\t\tthis.arenaHeightPx = ARENA_HEIGHT;\n\n\t\tthis.events.emit("scene-awake");\n\t}\n\n\tprivate arenaWidthPx = ARENA_WIDTH;\n\tprivate arenaHeightPx = ARENA_HEIGHT;\n\tprivate arenaProps: Phaser.GameObjects.Image[] = [];\n\n\t/* START-USER-CODE */\n\n\tprivate runtime?: ArenaRuntime\n\n\tpreload(): void {\n\t\tthis.load.pack("arena-assets", "/assets/arena-asset-pack.json")\n\t\twireSceneLoaderProgress(this, {\n\t\t\tscene: "Arena",\n\t\t\tdescription: "Arena assets",\n\t\t})\n\t}\n\n\tcreate(): void {\n\t\tthis.editorCreate()\n\t\tthis.runtime = new ArenaRuntime(this, {\n\t\t\tarenaWidthPx: this.arenaWidthPx,\n\t\t\tarenaHeightPx: this.arenaHeightPx,\n\t\t})\n\t\tthis.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {\n\t\t\tthis.runtime?.destroy()\n\t\t\tthis.runtime = undefined\n\t\t})\n\t\tthis.runtime.start()\n\t\tpublishLoaderComplete(this.game as unknown as Parameters<typeof publishLoaderComplete>[0])\n\t}\n\n\tupdate(time: number, delta: number): void {\n\t\tthis.runtime?.update(time, delta)\n\t}\n\n\t/** Phaser group used to collect all player sprites for iteration. */\n\tget playerGroup(): Phaser.GameObjects.Group {\n\t\treturn this.runtime?.playerGroup as Phaser.GameObjects.Group\n\t}\n\n\t/** Exposed for existing e2e diagnostics. */\n\tget playerRenderSystem(): PlayerRenderSystem | undefined {\n\t\treturn this.runtime?.playerRenderSystem\n\t}\n\n\tgetConnection(): GameConnection {\n\t\treturn this.runtime?.getConnection() as GameConnection\n\t}\n\n\tgetLocalPlayerId(): string | null {\n\t\treturn (\n\t\t\tthis.runtime?.getLocalPlayerId() ??\n\t\t\t((this.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as string | undefined) ?? null)\n\t\t)\n\t}\n\n\t/** Applies user-facing audio volume settings to the active runtime. */\n\tsetAudioVolumes(settings: {\n\t\treadonly bgmVolume?: number\n\t\treadonly sfxVolume?: number\n\t}): void {\n\t\tthis.runtime?.setAudioVolumes(settings)\n\t}\n\n\t/** Applies local-only debug overlay mode to the active runtime. */\n\tsetDebugModeEnabled(enabled: boolean): void {\n\t\tthis.runtime?.setDebugModeEnabled(enabled)\n\t}\n\n\t/** Applies persisted minimap placement to the active runtime. */\n\tsetMinimapCorner(corner: MinimapCorner): void {\n\t\tthis.runtime?.setMinimapCorner(corner)\n\t}\n\n\t/* END-USER-CODE */\n}\n\n/* END OF COMPILED CODE */\n\n// You can write more code here\n`,
    "utf8",
  )
}

function assetEntries(
  props: readonly PropInstance[],
  absolute: boolean,
  includeTilemap = !absolute,
): Record<string, unknown>[] {
  const prefix = absolute ? "/assets" : "assets"
  return [
    { type: "image", key: "arena-base", url: `${prefix}/maps/arena-base.png` },
    ...(includeTilemap
      ? [{ type: "tilemapTiledJSON", key: "arena", url: `${prefix}/tilemaps/arena.json` }]
      : []),
    ...props.map((prop) => ({
      type: "image",
      key: prop.key,
      url: `${prefix}/sprites/arena-props/${prop.fileName}`,
    })),
  ]
}

function writeAssetPacks(props: readonly PropInstance[]): void {
  const arenaPackPath = resolve(ROOT, "public/assets/arena-asset-pack.json")
  const currentArenaPack = JSON.parse(readFileSync(arenaPackPath, "utf8")) as {
    meta: unknown
    arena: { files: Record<string, unknown>[] }
  }
  const preservedArenaFiles = currentArenaPack.arena.files.filter((file) => {
    const key = String(file.key ?? "")
    return key !== "arena" && key !== "arena-base" && !key.startsWith("arena-prop-")
  })
  currentArenaPack.arena.files = [...assetEntries(props, true), ...preservedArenaFiles]
  writeFileSync(arenaPackPath, `${JSON.stringify(currentArenaPack, null, 4)}\n`, "utf8")

  const editorPackPath = resolve(ROOT, "public/assets/asset-pack.json")
  const editorPack = JSON.parse(readFileSync(editorPackPath, "utf8")) as {
    meta: unknown
    arena?: { files: Record<string, unknown>[] }
    section1?: unknown
  }
  editorPack.arena = { files: assetEntries(props, false) }
  writeFileSync(editorPackPath, `${JSON.stringify(editorPack, null, 4)}\n`, "utf8")
}

function writeArenaLayout(width: number, height: number, spawns: readonly SpawnPoint[]): void {
  writeFileSync(
    resolve(ROOT, "src/shared/balance-config/arena-layout.ts"),
    `/**\n * Project-owned native Arena layout data.\n *\n * The arena visual is image-backed at native map resolution. Keep this file in\n * sync with \`Arena.scene\`, \`public/assets/tilemaps/arena.json\`, and the\n * generated collider files when the arena changes.\n */\nexport const ARENA_LAYOUT_WIDTH = ${width}\nexport const ARENA_LAYOUT_HEIGHT = ${height}\nexport const ARENA_LAYOUT_COLS = ${Math.ceil(width / TILE_SIZE_PX)}\nexport const ARENA_LAYOUT_ROWS = ${Math.ceil(height / TILE_SIZE_PX)}\nexport const ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID = 17\nexport const ARENA_LAYOUT_SPAWN_POINTS = ${JSON.stringify(spawns, null, 2)} as const\n`,
    "utf8",
  )
}

function writeMetadata(
  width: number,
  height: number,
  props: readonly PropInstance[],
  propColliders: readonly Rect[],
  lavaRects: readonly Rect[],
  walkableRects: readonly Rect[],
  spawns: readonly SpawnPoint[],
): void {
  const metadata = {
    generatedFrom: {
      obstacleSheet: repoPath(OBSTACLE_SHEET),
      noBackgroundWithObstacles: repoPath(NO_BG_WITH_OBSTACLES),
      noBackgroundNoObstacles: repoPath(NO_BG_NO_OBSTACLES),
      lavaWithObstacles: repoPath(LAVA_WITH_OBSTACLES),
      lavaNoObstacles: repoPath(LAVA_NO_OBSTACLES),
    },
    arena: { width, height },
    regionCellPx: REGION_CELL_PX,
    props,
    propColliders,
    nonWalkableAreas: lavaRects,
    lavaAreas: lavaRects,
    cliffAreas: [],
    walkableAreas: walkableRects,
    spawnPoints: spawns,
  }
  writeFileSync(resolve(PROP_DIR, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
  writeFileSync(
    resolve(GENERATED_REVIEW_DIR, "placements.json"),
    `${JSON.stringify({ placements: props, propColliders }, null, 2)}\n`,
    "utf8",
  )
}

async function writeReviewImages(
  basePath: string,
  props: readonly PropInstance[],
  propColliders: readonly Rect[],
  lavaRects: readonly Rect[],
  walkableRects: readonly Rect[],
  width: number,
  height: number,
  propMask: Uint8Array,
): Promise<void> {
  await writeMaskImage(propMask, width, height, resolve(GENERATED_REVIEW_DIR, "prop-mask.png"), {
    r: 255,
    g: 255,
    b: 0,
  })

  const rectangleSvg = (rects: readonly Rect[], color: string, opacity: number) =>
    rects
      .map(
        (rect) =>
          `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-opacity="0.8" stroke-width="2"/>`,
      )
      .join("")
  const overlaySvg = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
      rectangleSvg(lavaRects, "#ff3000", 0.08) +
      rectangleSvg(walkableRects, "#50ff78", 0.05) +
      rectangleSvg(propColliders, "#ffff00", 0.35) +
      `</svg>`,
  )
  await sharp(basePath)
    .composite([{ input: overlaySvg, left: 0, top: 0 }])
    .png()
    .toFile(resolve(GENERATED_REVIEW_DIR, "runtime-rectangles-overlay.png"))

  const composites = props.map((prop) => ({
    input: resolve(PROP_DIR, prop.fileName),
    left: Math.round(prop.x - prop.width / 2),
    top: Math.round(prop.y - prop.height),
  }))
  await sharp(basePath)
    .composite(composites)
    .png()
    .toFile(resolve(GENERATED_REVIEW_DIR, "reconstructed-map.png"))
}

async function main(): Promise<void> {
  for (const dir of [MAP_DIR, PROP_DIR, GENERATED_REVIEW_DIR]) {
    mkdirSync(dir, { recursive: true })
  }

  const [walkableNoProps, noBgWithProps, lavaNoProps] = await Promise.all([
    loadRaw(NO_BG_NO_OBSTACLES),
    loadRaw(NO_BG_WITH_OBSTACLES),
    loadRaw(LAVA_NO_OBSTACLES),
  ])
  assertSameDimensions([walkableNoProps, noBgWithProps, lavaNoProps])

  await sharp(LAVA_NO_OBSTACLES).png().toFile(BASE_OUT)

  const propMask = createPropDiffMask(noBgWithProps, walkableNoProps)
  const props = await extractPropInstances(noBgWithProps, propMask)
  const propColliders = props.map(propColliderFor)
  const spawns = buildSpawnPoints(walkableNoProps, propColliders)

  const walkableRects = rectsFromCellMask(
    walkableNoProps.width,
    walkableNoProps.height,
    REGION_CELL_PX,
    (x, y) => isWalkablePixel(walkableNoProps, x, y),
  )
  const lavaRects = rectsFromCellMask(
    walkableNoProps.width,
    walkableNoProps.height,
    REGION_CELL_PX,
    (x, y) => !isWalkablePixel(walkableNoProps, x, y),
  )

  writeArenaScene(
    walkableNoProps.width,
    walkableNoProps.height,
    props,
    propColliders,
    lavaRects,
    lavaRects,
    walkableRects,
  )
  writeArenaRuntime(props)
  writeArenaLayout(walkableNoProps.width, walkableNoProps.height, spawns)
  writeAssetPacks(props)
  writeMetadata(
    walkableNoProps.width,
    walkableNoProps.height,
    props,
    propColliders,
    lavaRects,
    walkableRects,
    spawns,
  )
  await writeReviewImages(
    BASE_OUT,
    props,
    propColliders,
    lavaRects,
    walkableRects,
    walkableNoProps.width,
    walkableNoProps.height,
    propMask,
  )

  console.log(
    `Built no-cliff lava arena ${walkableNoProps.width}x${walkableNoProps.height} with ${props.length} prop instance(s), ${lavaRects.length} lava rect(s), ${walkableRects.length} walkable rect(s).`,
  )
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main()
}
