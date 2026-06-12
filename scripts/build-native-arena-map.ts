import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

type RawImage = {
  readonly data: Buffer
  readonly width: number
  readonly height: number
}

type Rect = { x: number; y: number; width: number; height: number }
type Component = Rect & { area: number }
type PropDef = {
  readonly id: string
  readonly label: string
  readonly source: Rect
  readonly width: number
  readonly height: number
}
type Placement = {
  readonly propId: string
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly flipX?: boolean
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, "..")

const SOURCE_BASE = "C:/Users/pinin/Downloads/map-base.png"
const SOURCE_OBJECTS = "C:/Users/pinin/Downloads/map-objects.png"
const SOURCE_TARGET = "C:/Users/pinin/Downloads/map-with-objects.png"

const ARENA_WIDTH = 1402
const ARENA_HEIGHT = 1122
const PROP_DIR = resolve(ROOT, "public/assets/sprites/arena-props")
const MAP_DIR = resolve(ROOT, "public/assets/maps")
const REVIEW_DIR = resolve(ROOT, "public/assets/arena-review/native-map")
const BASE_OUT = resolve(MAP_DIR, "arena-base.png")

const PROP_IDS = [
  ["large-obelisk", "Large Obelisk"],
  ["medium-obelisk", "Medium Obelisk"],
  ["tall-rune-pillar", "Tall Rune Pillar"],
  ["brazier-tower", "Brazier Tower"],
  ["small-obelisk", "Small Obelisk"],
  ["squat-plinth", "Squat Plinth"],
  ["curved-wall", "Curved Wall"],
  ["broken-wall", "Broken Wall"],
  ["straight-wall", "Straight Wall"],
  ["square-wall-block", "Square Wall Block"],
  ["lava-spire-cluster", "Lava Spire Cluster"],
  ["basalt-cluster", "Basalt Cluster"],
  ["round-rune-pillar", "Round Rune Pillar"],
  ["short-basalt-cluster", "Short Basalt Cluster"],
  ["stone-drum", "Stone Drum"],
  ["short-wall-slab", "Short Wall Slab"],
  ["small-rocks", "Small Rocks"],
] as const

const PLACEMENTS: readonly Placement[] = [
  { propId: "brazier-tower", x: 132, y: 146, scale: 0.24 },
  { propId: "brazier-tower", x: 225, y: 149, scale: 0.24 },
  { propId: "brazier-tower", x: 72, y: 121, scale: 0.23 },
  { propId: "brazier-tower", x: 1064, y: 146, scale: 0.24 },
  { propId: "brazier-tower", x: 1195, y: 149, scale: 0.24 },
  { propId: "brazier-tower", x: 1327, y: 121, scale: 0.23 },
  { propId: "tall-rune-pillar", x: 1326, y: 246, scale: 0.33 },
  { propId: "brazier-tower", x: 1306, y: 427, scale: 0.24 },
  { propId: "brazier-tower", x: 37, y: 427, scale: 0.24 },
  { propId: "small-rocks", x: 103, y: 382, scale: 0.36 },
  { propId: "basalt-cluster", x: 1260, y: 383, scale: 0.28 },

  { propId: "medium-obelisk", x: 459, y: 477, scale: 0.39 },
  { propId: "medium-obelisk", x: 613, y: 394, scale: 0.36 },
  { propId: "medium-obelisk", x: 806, y: 394, scale: 0.36 },
  { propId: "medium-obelisk", x: 1008, y: 563, scale: 0.39 },
  { propId: "medium-obelisk", x: 949, y: 723, scale: 0.37 },
  { propId: "medium-obelisk", x: 779, y: 781, scale: 0.36 },
  { propId: "medium-obelisk", x: 650, y: 781, scale: 0.36 },
  { propId: "medium-obelisk", x: 462, y: 706, scale: 0.37 },
  { propId: "medium-obelisk", x: 404, y: 588, scale: 0.37 },

  { propId: "brazier-tower", x: 521, y: 588, scale: 0.24 },
  { propId: "brazier-tower", x: 904, y: 588, scale: 0.24 },
  { propId: "brazier-tower", x: 946, y: 423, scale: 0.24 },
  { propId: "brazier-tower", x: 464, y: 423, scale: 0.24 },
  { propId: "brazier-tower", x: 650, y: 209, scale: 0.24 },
  { propId: "brazier-tower", x: 777, y: 209, scale: 0.24 },
  { propId: "brazier-tower", x: 650, y: 874, scale: 0.24 },
  { propId: "brazier-tower", x: 785, y: 874, scale: 0.24 },

  { propId: "straight-wall", x: 548, y: 445, scale: 0.32 },
  { propId: "straight-wall", x: 868, y: 445, scale: 0.32 },
  { propId: "straight-wall", x: 558, y: 676, scale: 0.31 },
  { propId: "straight-wall", x: 860, y: 676, scale: 0.31 },
  { propId: "short-wall-slab", x: 650, y: 560, scale: 0.33 },
  { propId: "short-wall-slab", x: 775, y: 560, scale: 0.33, flipX: true },

  { propId: "brazier-tower", x: 392, y: 864, scale: 0.24 },
  { propId: "brazier-tower", x: 1017, y: 864, scale: 0.24 },
  { propId: "brazier-tower", x: 1296, y: 923, scale: 0.24 },
  { propId: "brazier-tower", x: 106, y: 923, scale: 0.24 },
  { propId: "lava-spire-cluster", x: 164, y: 1008, scale: 0.28 },
  { propId: "lava-spire-cluster", x: 1240, y: 1008, scale: 0.28, flipX: true },
]

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function subtractRect(source: Rect, cut: Rect): Rect[] {
  if (!rectsOverlap(source, cut)) return [source]

  const sx1 = source.x + source.width
  const sy1 = source.y + source.height
  const cx0 = Math.max(source.x, cut.x)
  const cy0 = Math.max(source.y, cut.y)
  const cx1 = Math.min(sx1, cut.x + cut.width)
  const cy1 = Math.min(sy1, cut.y + cut.height)
  const out: Rect[] = []

  if (cy0 > source.y) out.push({ x: source.x, y: source.y, width: source.width, height: cy0 - source.y })
  if (cy1 < sy1) out.push({ x: source.x, y: cy1, width: source.width, height: sy1 - cy1 })
  if (cx0 > source.x) out.push({ x: source.x, y: cy0, width: cx0 - source.x, height: cy1 - cy0 })
  if (cx1 < sx1) out.push({ x: cx1, y: cy0, width: sx1 - cx1, height: cy1 - cy0 })

  return out.filter((rect) => rect.width > 0 && rect.height > 0)
}

function subtractMany(sources: readonly Rect[], cuts: readonly Rect[]): Rect[] {
  const out: Rect[] = []
  for (const source of sources) {
    let pieces = [source]
    for (const cut of cuts) {
      pieces = pieces.flatMap((piece) => subtractRect(piece, cut))
    }
    out.push(...pieces)
  }
  return out
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height)
}

const WALKABLE_RECTS: readonly Rect[] = [
  { x: 432, y: 252, width: 536, height: 592 },
  { x: 666, y: 130, width: 72, height: 122 },
  { x: 238, y: 535, width: 230, height: 66 },
  { x: 936, y: 535, width: 230, height: 66 },
  { x: 665, y: 790, width: 78, height: 230 },
  { x: 332, y: 760, width: 155, height: 155 },
  { x: 911, y: 760, width: 155, height: 155 },
  { x: 82, y: 775, width: 178, height: 178 },
  { x: 1144, y: 775, width: 178, height: 178 },
  { x: 64, y: 118, width: 224, height: 170 },
  { x: 1115, y: 118, width: 224, height: 170 },
  { x: 55, y: 316, width: 154, height: 154 },
  { x: 1194, y: 316, width: 154, height: 154 },
  { x: 297, y: 180, width: 190, height: 72 },
  { x: 916, y: 180, width: 190, height: 72 },
  { x: 294, y: 871, width: 126, height: 82 },
  { x: 983, y: 871, width: 126, height: 82 },
]

const RAW_LAVA_RECTS: readonly Rect[] = [
  { x: 0, y: 0, width: 360, height: 120 },
  { x: 1038, y: 0, width: 364, height: 120 },
  { x: 302, y: 24, width: 304, height: 210 },
  { x: 798, y: 24, width: 304, height: 210 },
  { x: 0, y: 225, width: 392, height: 288 },
  { x: 1012, y: 225, width: 390, height: 288 },
  { x: 0, y: 612, width: 372, height: 190 },
  { x: 1030, y: 612, width: 372, height: 190 },
  { x: 0, y: 925, width: 82, height: 33 },
  { x: 260, y: 925, width: 34, height: 33 },
  { x: 420, y: 925, width: 245, height: 33 },
  { x: 743, y: 925, width: 240, height: 33 },
  { x: 1109, y: 925, width: 35, height: 33 },
  { x: 1322, y: 925, width: 80, height: 33 },
  { x: 0, y: 958, width: 665, height: 62 },
  { x: 743, y: 958, width: 659, height: 62 },
  { x: 0, y: 1020, width: 635, height: 78 },
  { x: 772, y: 1020, width: 630, height: 78 },
  { x: 475, y: 848, width: 190, height: 110 },
  { x: 742, y: 848, width: 190, height: 110 },
]

const RAW_CLIFF_RECTS: readonly Rect[] = [
  { x: 0, y: 0, width: 1402, height: 24 },
  { x: 0, y: 1098, width: 1402, height: 24 },
  { x: 0, y: 0, width: 24, height: 1122 },
  { x: 1378, y: 0, width: 24, height: 1122 },
  { x: 432, y: 220, width: 536, height: 32 },
  { x: 370, y: 288, width: 62, height: 247 },
  { x: 970, y: 288, width: 62, height: 247 },
  { x: 370, y: 601, width: 62, height: 231 },
  { x: 970, y: 601, width: 62, height: 231 },
  { x: 238, y: 513, width: 230, height: 22 },
  { x: 238, y: 601, width: 230, height: 22 },
  { x: 936, y: 513, width: 230, height: 22 },
  { x: 936, y: 601, width: 230, height: 22 },
  { x: 643, y: 790, width: 22, height: 230 },
  { x: 743, y: 790, width: 22, height: 230 },
  { x: 360, y: 196, width: 120, height: 92 },
  { x: 922, y: 196, width: 120, height: 92 },
  { x: 64, y: 88, width: 224, height: 30 },
  { x: 64, y: 288, width: 224, height: 30 },
  { x: 34, y: 88, width: 30, height: 230 },
  { x: 288, y: 88, width: 30, height: 230 },
  { x: 1115, y: 88, width: 224, height: 30 },
  { x: 1115, y: 288, width: 224, height: 30 },
  { x: 1085, y: 88, width: 30, height: 230 },
  { x: 1339, y: 88, width: 30, height: 230 },
  { x: 55, y: 286, width: 154, height: 30 },
  { x: 55, y: 470, width: 154, height: 30 },
  { x: 25, y: 286, width: 30, height: 214 },
  { x: 209, y: 286, width: 30, height: 214 },
  { x: 1194, y: 286, width: 154, height: 30 },
  { x: 1194, y: 470, width: 154, height: 30 },
  { x: 1164, y: 286, width: 30, height: 214 },
  { x: 1348, y: 286, width: 30, height: 214 },
  { x: 82, y: 745, width: 178, height: 30 },
  { x: 82, y: 953, width: 178, height: 30 },
  { x: 52, y: 745, width: 30, height: 238 },
  { x: 260, y: 745, width: 30, height: 238 },
  { x: 1144, y: 745, width: 178, height: 30 },
  { x: 1144, y: 953, width: 178, height: 30 },
  { x: 1114, y: 745, width: 30, height: 238 },
  { x: 1322, y: 745, width: 30, height: 238 },
  { x: 358, y: 832, width: 288, height: 58 },
  { x: 756, y: 832, width: 288, height: 58 },
  { x: 604, y: 836, width: 60, height: 124 },
  { x: 742, y: 836, width: 60, height: 124 },
]

const CLIFF_RECTS: readonly Rect[] = subtractMany(RAW_CLIFF_RECTS, WALKABLE_RECTS)
const LAVA_RECTS: readonly Rect[] = subtractMany(RAW_LAVA_RECTS, [...WALKABLE_RECTS, ...CLIFF_RECTS])

const SPAWNS = [
  { x: 710, y: 562 },
  { x: 585, y: 560 },
  { x: 835, y: 560 },
  { x: 710, y: 410 },
  { x: 710, y: 710 },
  { x: 510, y: 505 },
  { x: 910, y: 505 },
  { x: 512, y: 625 },
  { x: 908, y: 625 },
  { x: 186, y: 856 },
  { x: 1216, y: 856 },
  { x: 710, y: 930 },
] as const

async function loadRaw(path: string): Promise<RawImage> {
  const image = sharp(path).ensureAlpha()
  const meta = await image.metadata()
  const data = await image.raw().toBuffer()
  return {
    data,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  }
}

function isCheckerBackground(r: number, g: number, b: number): boolean {
  return (
    r > 222 &&
    g > 222 &&
    b > 222 &&
    Math.max(r, g, b) - Math.min(r, g, b) < 10
  )
}

function componentRects(mask: Uint8Array, width: number, height: number, minArea: number): Component[] {
  const seen = new Uint8Array(width * height)
  const q = new Int32Array(width * height)
  const out: Component[] = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x
      if (!mask[start] || seen[start]) continue

      let head = 0
      let tail = 0
      q[tail++] = start
      seen[start] = 1
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      let area = 0

      while (head < tail) {
        const i = q[head++]!
        const cx = i % width
        const cy = Math.floor(i / width)
        area++
        minX = Math.min(minX, cx)
        maxX = Math.max(maxX, cx)
        minY = Math.min(minY, cy)
        maxY = Math.max(maxY, cy)

        const neighbors = [i - 1, i + 1, i - width, i + width]
        for (const n of neighbors) {
          if (n < 0 || n >= mask.length || seen[n] || !mask[n]) continue
          const nx = n % width
          if (Math.abs(nx - cx) > 1) continue
          seen[n] = 1
          q[tail++] = n
        }
      }

      if (area >= minArea) {
        out.push({
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          area,
        })
      }
    }
  }

  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

async function extractProps(): Promise<PropDef[]> {
  const raw = await loadRaw(SOURCE_OBJECTS)
  const mask = new Uint8Array(raw.width * raw.height)

  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = raw.data[p]!
    const g = raw.data[p + 1]!
    const b = raw.data[p + 2]!
    const orange = r > 120 && g > 30 && g < 175 && b < 95
    const dark = r < 216 || g < 216 || b < 216
    mask[i] = (orange || dark) && !isCheckerBackground(r, g, b) ? 1 : 0
  }

  const components = componentRects(mask, raw.width, raw.height, 80)
  if (components.length !== PROP_IDS.length) {
    throw new Error(`Expected ${PROP_IDS.length} prop components, found ${components.length}`)
  }

  const defs: PropDef[] = []
  for (let i = 0; i < components.length; i++) {
    const component = components[i]!
    const [id, label] = PROP_IDS[i]!
    const pad = 4
    const x = Math.max(0, component.x - pad)
    const y = Math.max(0, component.y - pad)
    const width = Math.min(raw.width - x, component.width + pad * 2)
    const height = Math.min(raw.height - y, component.height + pad * 2)
    const crop = Buffer.alloc(width * height * 4)

    for (let yy = 0; yy < height; yy++) {
      for (let xx = 0; xx < width; xx++) {
        const src = ((y + yy) * raw.width + x + xx) * 4
        const dst = (yy * width + xx) * 4
        const r = raw.data[src]!
        const g = raw.data[src + 1]!
        const b = raw.data[src + 2]!
        crop[dst] = r
        crop[dst + 1] = g
        crop[dst + 2] = b
        crop[dst + 3] = isCheckerBackground(r, g, b) ? 0 : 255
      }
    }

    await sharp(crop, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(resolve(PROP_DIR, `${id}.png`))
    defs.push({ id, label, source: { x, y, width, height }, width, height })
  }
  return defs
}

async function makeChecker(width: number, height: number): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? 230 : 205
      const i = (y * width + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function writeContactSheet(props: readonly PropDef[]): Promise<void> {
  const cellW = 210
  const cellH = 190
  const cols = 4
  const rows = Math.ceil(props.length / cols)
  const base = await makeChecker(cols * cellW, rows * cellH)
  const composites: sharp.OverlayOptions[] = []

  for (let i = 0; i < props.length; i++) {
    const prop = props[i]!
    const maxW = cellW - 24
    const maxH = cellH - 32
    const scale = Math.min(maxW / prop.width, maxH / prop.height, 1)
    const input = await sharp(resolve(PROP_DIR, `${prop.id}.png`))
      .resize(Math.round(prop.width * scale), Math.round(prop.height * scale))
      .png()
      .toBuffer()
    const col = i % cols
    const row = Math.floor(i / cols)
    composites.push({
      input,
      left: col * cellW + Math.round((cellW - prop.width * scale) / 2),
      top: row * cellH + Math.round((cellH - prop.height * scale) / 2),
    })
  }

  await sharp(base).composite(composites).png().toFile(resolve(REVIEW_DIR, "prop-contact-sheet.png"))
}

async function renderReconstruction(props: readonly PropDef[]): Promise<void> {
  const propById = new Map(props.map((p) => [p.id, p]))
  const composites: sharp.OverlayOptions[] = []
  const propFootprints: Rect[] = []
  for (const placement of PLACEMENTS) {
    const prop = propById.get(placement.propId)
    if (!prop) throw new Error(`Unknown prop ${placement.propId}`)
    const scaleX = placement.flipX ? -placement.scale : placement.scale
    const width = Math.max(1, Math.round(prop.width * placement.scale))
    const height = Math.max(1, Math.round(prop.height * placement.scale))
    let input = sharp(resolve(PROP_DIR, `${prop.id}.png`)).resize(width, height)
    if (scaleX < 0) input = input.flop()
    propFootprints.push({
      x: Math.max(0, Math.round(placement.x - width / 2) - 8),
      y: Math.max(0, Math.round(placement.y - height) - 8),
      width: Math.min(ARENA_WIDTH, width + 16),
      height: Math.min(ARENA_HEIGHT, height + 16),
    })
    composites.push({
      input: await input.png().toBuffer(),
      left: Math.round(placement.x - width / 2),
      top: Math.round(placement.y - height),
    })
  }
  await sharp(BASE_OUT)
    .composite(composites)
    .png()
    .toFile(resolve(REVIEW_DIR, "reconstructed-map.png"))

  const target = await loadRaw(SOURCE_TARGET)
  const recon = await loadRaw(resolve(REVIEW_DIR, "reconstructed-map.png"))
  const diff = Buffer.alloc(ARENA_WIDTH * ARENA_HEIGHT * 4)
  const propMask = new Uint8Array(ARENA_WIDTH * ARENA_HEIGHT)
  for (const rect of propFootprints) {
    const x0 = Math.max(0, rect.x)
    const y0 = Math.max(0, rect.y)
    const x1 = Math.min(ARENA_WIDTH, rect.x + rect.width)
    const y1 = Math.min(ARENA_HEIGHT, rect.y + rect.height)
    for (let y = y0; y < y1; y++) {
      propMask.fill(1, y * ARENA_WIDTH + x0, y * ARENA_WIDTH + x1)
    }
  }

  for (let i = 0, p = 0; i < ARENA_WIDTH * ARENA_HEIGHT; i++, p += 4) {
    if (!propMask[i]) {
      const base = Math.round((target.data[p]! + target.data[p + 1]! + target.data[p + 2]!) / 3)
      diff[p] = base
      diff[p + 1] = base
      diff[p + 2] = base
      diff[p + 3] = 26
      continue
    }
    const dr = Math.abs(target.data[p]! - recon.data[p]!)
    const dg = Math.abs(target.data[p + 1]! - recon.data[p + 1]!)
    const db = Math.abs(target.data[p + 2]! - recon.data[p + 2]!)
    const max = Math.max(dr, dg, db)
    diff[p] = Math.min(255, dr * 5 + 60)
    diff[p + 1] = Math.min(255, dg * 3)
    diff[p + 2] = Math.min(255, db * 3)
    diff[p + 3] = max > 18 ? 255 : 55
  }
  await sharp(diff, { raw: { width: ARENA_WIDTH, height: ARENA_HEIGHT, channels: 4 } })
    .png()
    .toFile(resolve(REVIEW_DIR, "reconstruction-diff.png"))
}

function numberedPlacementSvg(): Buffer {
  const labels = PLACEMENTS.map((placement, index) => {
    const label = String(index + 1)
    return `<g transform="translate(${placement.x} ${placement.y})"><circle r="12" fill="#ffe600" fill-opacity="0.88" stroke="#111111" stroke-width="2"/><text y="1" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#111111">${label}</text></g>`
  }).join("")
  return Buffer.from(`<svg width="${ARENA_WIDTH}" height="${ARENA_HEIGHT}" viewBox="0 0 ${ARENA_WIDTH} ${ARENA_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`)
}

function scaledColliderForPlacement(props: readonly PropDef[], placement: Placement, index: number): Rect & { name: string } {
  const prop = props.find((p) => p.id === placement.propId)
  if (!prop) throw new Error(`Unknown prop ${placement.propId}`)
  const width = Math.max(8, Math.round(prop.width * placement.scale * 0.72))
  const height = Math.max(8, Math.round(prop.height * placement.scale * 0.3))
  return {
    name: `propCollider_${String(index).padStart(3, "0")}`,
    x: Math.round(placement.x - width / 2),
    y: Math.round(placement.y - height),
    width,
    height,
  }
}

function colorRectLayer(
  props: readonly PropDef[],
  rects: readonly (Rect & { readonly name?: string })[],
  color: { r: number; g: number; b: number; a: number },
): Buffer {
  const data = Buffer.alloc(ARENA_WIDTH * ARENA_HEIGHT * 4)
  for (const rect of rects) {
    const x0 = Math.max(0, rect.x)
    const y0 = Math.max(0, rect.y)
    const x1 = Math.min(ARENA_WIDTH, rect.x + rect.width)
    const y1 = Math.min(ARENA_HEIGHT, rect.y + rect.height)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const edge = x === x0 || y === y0 || x === x1 - 1 || y === y1 - 1
        const i = (y * ARENA_WIDTH + x) * 4
        data[i] = color.r
        data[i + 1] = color.g
        data[i + 2] = color.b
        data[i + 3] = edge ? 255 : color.a
      }
    }
  }
  void props
  return data
}

async function writeOverlayImages(props: readonly PropDef[]): Promise<void> {
  const propColliders = PLACEMENTS.map((p, i) => scaledColliderForPlacement(props, p, i))
  const overlays = [
    ["object-collision-yellow-highlight.png", propColliders, { r: 255, g: 230, b: 0, a: 115 }],
    ["walkable-lines.png", WALKABLE_RECTS, { r: 80, g: 255, b: 120, a: 40 }],
    ["cliff-lines.png", CLIFF_RECTS, { r: 255, g: 255, b: 255, a: 70 }],
    ["lava-lines.png", LAVA_RECTS, { r: 255, g: 60, b: 0, a: 75 }],
  ] as const

  for (const [name, rects, color] of overlays) {
    const overlay = await sharp(colorRectLayer(props, rects, color), {
      raw: { width: ARENA_WIDTH, height: ARENA_HEIGHT, channels: 4 },
    }).png().toBuffer()
    await sharp(BASE_OUT)
      .composite([{ input: overlay, left: 0, top: 0 }])
      .png()
      .toFile(resolve(REVIEW_DIR, name))
  }

  const combined = await sharp(BASE_OUT)
    .composite([
      {
        input: await sharp(colorRectLayer(props, WALKABLE_RECTS, { r: 80, g: 255, b: 120, a: 36 }), {
          raw: { width: ARENA_WIDTH, height: ARENA_HEIGHT, channels: 4 },
        }).png().toBuffer(),
      },
      {
        input: await sharp(colorRectLayer(props, LAVA_RECTS, { r: 255, g: 60, b: 0, a: 70 }), {
          raw: { width: ARENA_WIDTH, height: ARENA_HEIGHT, channels: 4 },
        }).png().toBuffer(),
      },
      {
        input: await sharp(colorRectLayer(props, CLIFF_RECTS, { r: 255, g: 255, b: 255, a: 70 }), {
          raw: { width: ARENA_WIDTH, height: ARENA_HEIGHT, channels: 4 },
        }).png().toBuffer(),
      },
      {
        input: await sharp(colorRectLayer(props, propColliders, { r: 255, g: 230, b: 0, a: 105 }), {
          raw: { width: ARENA_WIDTH, height: ARENA_HEIGHT, channels: 4 },
        }).png().toBuffer(),
      },
    ])
    .png()
    .toFile(resolve(REVIEW_DIR, "all-overlays-combined.png"))
  void combined

  await sharp(resolve(REVIEW_DIR, "reconstructed-map.png"))
    .composite([{ input: numberedPlacementSvg(), left: 0, top: 0 }])
    .png()
    .toFile(resolve(REVIEW_DIR, "numbered-placement-overlay.png"))
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
  }
}

function writeSceneAndRuntimeSources(props: readonly PropDef[]): void {
  const propById = new Map(props.map((p) => [p.id, p]))
  const propColliders = PLACEMENTS.map((p, i) => scaledColliderForPlacement(props, p, i))

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

  for (let i = 0; i < PLACEMENTS.length; i++) {
    const placement = PLACEMENTS[i]!
    displayList.push({
      type: "Image",
      id: `arena_prop_${String(i).padStart(3, "0")}`,
      label: `arena_prop_${String(i).padStart(3, "0")}_${placement.propId}`,
      texture: { key: `arena-prop-${placement.propId}` },
      x: placement.x,
      y: placement.y,
      originX: 0.5,
      originY: 1,
      scaleX: placement.flipX ? -placement.scale : placement.scale,
      scaleY: placement.scale,
    })
  }

  for (let i = 0; i < propColliders.length; i++) {
    const rect = propColliders[i]!
    displayList.push(rectangleSceneObject(rect.name, rect.name, rect, 0xffff00))
  }
  for (let i = 0; i < LAVA_RECTS.length; i++) {
    const label = `lavaArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, LAVA_RECTS[i]!, 0xff3c00))
  }
  for (let i = 0; i < CLIFF_RECTS.length; i++) {
    const label = `cliffArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, CLIFF_RECTS[i]!, 0xffffff))
  }
  for (let i = 0; i < [...LAVA_RECTS, ...CLIFF_RECTS].length; i++) {
    const rect = [...LAVA_RECTS, ...CLIFF_RECTS][i]!
    const label = `nonWalkableArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, rect, 0xff0000))
  }
  for (let i = 0; i < WALKABLE_RECTS.length; i++) {
    const label = `walkableArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, WALKABLE_RECTS[i]!, 0x50ff78))
  }

  writeFileSync(
    resolve(ROOT, "src/game/scenes/Arena.scene"),
    `${JSON.stringify(
      {
        id: "arena-scene",
        sceneType: "SCENE",
        settings: {
          exportClass: true,
          autoImport: true,
          preloadPackFiles: [],
          createMethodName: "editorCreate",
          sceneKey: "Arena",
          compilerOutputLanguage: "TYPE_SCRIPT",
          borderWidth: ARENA_WIDTH,
          borderHeight: ARENA_HEIGHT,
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
      4,
    )}\n`,
    "utf8",
  )

  const propCreateLines = PLACEMENTS.map((placement, index) => {
    const prop = propById.get(placement.propId)!
    const key = `arena-prop-${placement.propId}`
    const varName = `arenaProp${index}`
    return `\n\t\t// ${varName}\n\t\tconst ${varName} = this.add.image(${placement.x}, ${placement.y}, "${key}");\n\t\t${varName}.setOrigin(0.5, 1);\n\t\t${varName}.setScale(${placement.flipX ? -placement.scale : placement.scale}, ${placement.scale});\n\t\t${varName}.setDepth(${placement.y});\n\t\tthis.arenaProps.push(${varName}); // ${prop.label}`
  }).join("\n")

  writeFileSync(
    resolve(ROOT, "src/game/scenes/Arena.ts"),
    `// You can write more code here\n\n/* START OF COMPILED CODE */\n\n/* START-USER-IMPORTS */\nimport Phaser from "phaser"\n\nimport { ARENA_HEIGHT, ARENA_WIDTH } from "@/shared/balance-config/arena"\nimport { TILEMAP_DEPTH } from "@/shared/balance-config/rendering"\nimport type { MinimapCorner } from "@/shared/settings-config"\nimport { WW_LOCAL_PLAYER_ID_REGISTRY_KEY } from "../constants"\nimport { GameConnection } from "../network/GameConnection"\nimport { PlayerRenderSystem } from "../ecs/systems/PlayerRenderSystem"\nimport {\n  publishLoaderComplete,\n  wireSceneLoaderProgress,\n} from "../loaderStatus"\nimport { ArenaRuntime } from "./ArenaRuntime"\n/* END-USER-IMPORTS */\n\nexport default class Arena extends Phaser.Scene {\n\n\tconstructor() {\n\t\tsuper("Arena");\n\n\t\t/* START-USER-CTR-CODE */\n\t\t/* END-USER-CTR-CODE */\n\t}\n\n\teditorCreate(): void {\n\n\t\t// arena_base\n\t\tconst arenaBase = this.add.image(0, 0, "arena-base");\n\t\tarenaBase.setOrigin(0, 0);\n\t\tarenaBase.setDepth(TILEMAP_DEPTH);\n${propCreateLines}\n\n\t\tthis.arenaWidthPx = ARENA_WIDTH;\n\t\tthis.arenaHeightPx = ARENA_HEIGHT;\n\n\t\tthis.events.emit("scene-awake");\n\t}\n\n\tprivate arenaWidthPx = ARENA_WIDTH;\n\tprivate arenaHeightPx = ARENA_HEIGHT;\n\tprivate arenaProps: Phaser.GameObjects.Image[] = [];\n\n\t/* START-USER-CODE */\n\n\tprivate runtime?: ArenaRuntime\n\n\tpreload(): void {\n\t\tthis.load.pack("arena-assets", "/assets/arena-asset-pack.json")\n\t\twireSceneLoaderProgress(this, {\n\t\t\tscene: "Arena",\n\t\t\tdescription: "Arena assets",\n\t\t})\n\t}\n\n\tcreate(): void {\n\t\tthis.editorCreate()\n\t\tthis.runtime = new ArenaRuntime(this, {\n\t\t\tarenaWidthPx: this.arenaWidthPx,\n\t\t\tarenaHeightPx: this.arenaHeightPx,\n\t\t})\n\t\tthis.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {\n\t\t\tthis.runtime?.destroy()\n\t\t\tthis.runtime = undefined\n\t\t})\n\t\tthis.runtime.start()\n\t\tpublishLoaderComplete(this.game as unknown as Parameters<typeof publishLoaderComplete>[0])\n\t}\n\n\tupdate(time: number, delta: number): void {\n\t\tthis.runtime?.update(time, delta)\n\t}\n\n\t/** Phaser group used to collect all player sprites for iteration. */\n\tget playerGroup(): Phaser.GameObjects.Group {\n\t\treturn this.runtime?.playerGroup as Phaser.GameObjects.Group\n\t}\n\n\t/** Exposed for existing e2e diagnostics. */\n\tget playerRenderSystem(): PlayerRenderSystem | undefined {\n\t\treturn this.runtime?.playerRenderSystem\n\t}\n\n\tgetConnection(): GameConnection {\n\t\treturn this.runtime?.getConnection() as GameConnection\n\t}\n\n\tgetLocalPlayerId(): string | null {\n\t\treturn (\n\t\t\tthis.runtime?.getLocalPlayerId() ??\n\t\t\t((this.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as string | undefined) ?? null)\n\t\t)\n\t}\n\n\t/** Applies user-facing audio volume settings to the active runtime. */\n\tsetAudioVolumes(settings: {\n\t\treadonly bgmVolume?: number\n\t\treadonly sfxVolume?: number\n\t}): void {\n\t\tthis.runtime?.setAudioVolumes(settings)\n\t}\n\n\t/** Applies local-only debug overlay mode to the active runtime. */\n\tsetDebugModeEnabled(enabled: boolean): void {\n\t\tthis.runtime?.setDebugModeEnabled(enabled)\n\t}\n\n\t/** Applies persisted minimap placement to the active runtime. */\n\tsetMinimapCorner(corner: MinimapCorner): void {\n\t\tthis.runtime?.setMinimapCorner(corner)\n\t}\n\n\t/* END-USER-CODE */\n}\n\n/* END OF COMPILED CODE */\n\n// You can write more code here\n`,
    "utf8",
  )
}

function assetEntries(props: readonly PropDef[], absolute: boolean): Record<string, unknown>[] {
  const prefix = absolute ? "/assets" : "assets"
  return [
    { type: "image", key: "arena-base", url: `${prefix}/maps/arena-base.png` },
    { type: "tilemapTiledJSON", key: "arena", url: `${prefix}/tilemaps/arena.json` },
    ...props.map((prop) => ({
      type: "image",
      key: `arena-prop-${prop.id}`,
      url: `${prefix}/sprites/arena-props/${prop.id}.png`,
    })),
  ]
}

function writeAssetPacks(props: readonly PropDef[]): void {
  const currentArenaPack = JSON.parse(readFileSync(resolve(ROOT, "public/assets/arena-asset-pack.json"), "utf8")) as {
    meta: unknown
    arena: { files: Record<string, unknown>[] }
  }
  const preservedArenaFiles = currentArenaPack.arena.files.filter((file) => {
    const key = String(file.key ?? "")
    return (
      !key.startsWith("prop-") &&
      key !== "arena" &&
      key !== "arena-terrain" &&
      key !== "arena-base" &&
      !key.startsWith("arena-prop-")
    )
  })
  currentArenaPack.arena.files = [...assetEntries(props, true), ...preservedArenaFiles]
  writeFileSync(resolve(ROOT, "public/assets/arena-asset-pack.json"), `${JSON.stringify(currentArenaPack, null, 4)}\n`, "utf8")

  const editorPack = JSON.parse(readFileSync(resolve(ROOT, "public/assets/asset-pack.json"), "utf8")) as {
    meta: unknown
    arena?: { files: Record<string, unknown>[] }
    section1?: unknown
  }
  editorPack.arena = { files: assetEntries(props, false) }
  writeFileSync(resolve(ROOT, "public/assets/asset-pack.json"), `${JSON.stringify(editorPack, null, 4)}\n`, "utf8")
}

function writeMetadata(props: readonly PropDef[]): void {
  const propColliders = PLACEMENTS.map((p, i) => scaledColliderForPlacement(props, p, i))
  const metadata = {
    generatedFrom: {
      base: SOURCE_BASE,
      objects: SOURCE_OBJECTS,
      target: SOURCE_TARGET,
    },
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    props,
    placements: PLACEMENTS,
    propColliders,
    lavaAreas: LAVA_RECTS,
    cliffAreas: CLIFF_RECTS,
    walkableAreas: WALKABLE_RECTS,
    spawnPoints: SPAWNS,
  }
  writeFileSync(resolve(PROP_DIR, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
  writeFileSync(resolve(REVIEW_DIR, "placements.json"), `${JSON.stringify({ placements: PLACEMENTS, propColliders }, null, 2)}\n`, "utf8")
}

function writeArenaLayout(): void {
  writeFileSync(
    resolve(ROOT, "src/shared/balance-config/arena-layout.ts"),
    `/**\n * Project-owned native Arena layout data.\n *\n * The arena visual is image-backed at native map resolution. Keep this file in\n * sync with \`Arena.scene\`, \`public/assets/tilemaps/arena.json\`, and the\n * generated collider files when the arena changes.\n */\nexport const ARENA_LAYOUT_WIDTH = ${ARENA_WIDTH}\nexport const ARENA_LAYOUT_HEIGHT = ${ARENA_HEIGHT}\nexport const ARENA_LAYOUT_COLS = 22\nexport const ARENA_LAYOUT_ROWS = 18\nexport const ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID = 17\nexport const ARENA_LAYOUT_SPAWN_POINTS = ${JSON.stringify(SPAWNS, null, 2)} as const\n`,
    "utf8",
  )
}

async function main(): Promise<void> {
  for (const dir of [PROP_DIR, MAP_DIR, REVIEW_DIR]) mkdirSync(dir, { recursive: true })
  copyFileSync(SOURCE_BASE, BASE_OUT)
  const props = await extractProps()
  writeMetadata(props)
  await writeContactSheet(props)
  await renderReconstruction(props)
  await writeOverlayImages(props)
  writeSceneAndRuntimeSources(props)
  writeAssetPacks(props)
  writeArenaLayout()
  console.log(`Built native arena assets from ${basename(SOURCE_BASE)} with ${props.length} prop sprites.`)
}

void main()
