import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import sharp from "sharp"

type RawImage = {
  readonly data: Buffer
  readonly width: number
  readonly height: number
}

type Rect = { x: number; y: number; width: number; height: number }
type Component = Rect & { area: number }
type Mask = {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}
type RegionClass = 0 | 1 | 2 | 3
type ClassifiedGrid = {
  readonly cells: Uint8Array
  readonly cols: number
  readonly rows: number
  readonly cellSize: number
}
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

const SOURCE_ARENA_WIDTH = 1402
const SOURCE_ARENA_HEIGHT = 1122
export const ARENA_OUTPUT_SCALE = 2
export const ARENA_OUTPUT_WIDTH = SOURCE_ARENA_WIDTH * ARENA_OUTPUT_SCALE
export const ARENA_OUTPUT_HEIGHT = SOURCE_ARENA_HEIGHT * ARENA_OUTPUT_SCALE
export const ARENA_OUTPUT_COLS = 44
export const ARENA_OUTPUT_ROWS = 36
const ARENA_WIDTH = SOURCE_ARENA_WIDTH
const ARENA_HEIGHT = SOURCE_ARENA_HEIGHT
const REGION_CELL_PX = 4
const PROP_DIR = resolve(ROOT, "public/assets/sprites/arena-props")
const MAP_DIR = resolve(ROOT, "public/assets/maps")
const REVIEW_DIR = resolve(ROOT, "public/assets/arena-review/native-map")
const SOURCE_IMAGE_DIR = resolve(REVIEW_DIR, "source-images")
const MASK_DIR = resolve(REVIEW_DIR, "source-masks")
const BASE_OUT = resolve(MAP_DIR, "arena-base.png")
const SOURCE_BASE = process.env.WW_ARENA_SOURCE_BASE ?? resolve(SOURCE_IMAGE_DIR, "map-base.png")
const SOURCE_OBJECTS = process.env.WW_ARENA_SOURCE_OBJECTS ?? resolve(SOURCE_IMAGE_DIR, "map-objects.png")
const SOURCE_TARGET = process.env.WW_ARENA_SOURCE_TARGET ?? resolve(SOURCE_IMAGE_DIR, "map-with-objects.png")
const SOURCE_WALKABLE_GUIDE =
  process.env.WW_ARENA_WALKABLE_GUIDE ?? resolve(SOURCE_IMAGE_DIR, "walkable-guide.png")
const WALKABLE_GUIDE_WIDTH = 922
const WALKABLE_GUIDE_HEIGHT = 735

const DETAIL_CROPS = [
  { label: "Top-left diagonal", x: 210, y: 165, width: 260, height: 210 },
  { label: "Top-right diagonal", x: 932, y: 165, width: 260, height: 210 },
  { label: "Bottom-left diagonal", x: 230, y: 700, width: 280, height: 220 },
  { label: "Bottom-right diagonal", x: 892, y: 700, width: 280, height: 220 },
  { label: "Left side neck", x: 0, y: 330, width: 220, height: 270 },
  { label: "Right side neck", x: 1182, y: 330, width: 220, height: 270 },
] as const

const TOP_LEFT_CORNER_CROP = { x: 0, y: 0, width: 470, height: 390 } as const
const BOTTOM_HALF_REVIEW_CROP = { x: 0, y: 670, width: ARENA_WIDTH, height: ARENA_HEIGHT - 670 } as const

function scaleArenaOutputValue(value: number): number {
  return Math.round(value * ARENA_OUTPUT_SCALE)
}

export function scaleArenaOutputRect<T extends Rect>(rect: T): T {
  return {
    ...rect,
    x: scaleArenaOutputValue(rect.x),
    y: scaleArenaOutputValue(rect.y),
    width: scaleArenaOutputValue(rect.width),
    height: scaleArenaOutputValue(rect.height),
  }
}

export function scaleArenaOutputPlacement(placement: Placement): Placement {
  return {
    ...placement,
    x: scaleArenaOutputValue(placement.x),
    y: scaleArenaOutputValue(placement.y),
    scale: placement.scale * ARENA_OUTPUT_SCALE,
  }
}

function scaleArenaOutputPoint<T extends { readonly x: number; readonly y: number }>(point: T): T {
  return {
    ...point,
    x: scaleArenaOutputValue(point.x),
    y: scaleArenaOutputValue(point.y),
  }
}

function scaleArenaOutputRects<T extends Rect>(rects: readonly T[]): T[] {
  return rects.map(scaleArenaOutputRect)
}

const REGION_NONE: RegionClass = 0
const REGION_WALKABLE: RegionClass = 1
const REGION_LAVA: RegionClass = 2
const REGION_CLIFF: RegionClass = 3

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
  { propId: "brazier-tower", x: 132, y: 86, scale: 0.24 },
  { propId: "brazier-tower", x: 224, y: 96, scale: 0.24 },
  { propId: "brazier-tower", x: 70, y: 134, scale: 0.23 },
  { propId: "brazier-tower", x: 269, y: 198, scale: 0.24 },
  { propId: "brazier-tower", x: 167, y: 246, scale: 0.24 },
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

type PropColliderSpec = {
  readonly widthRatio: number
  readonly heightRatio: number
  readonly offsetXRatio?: number
  readonly bottomOffsetRatio?: number
}

const DEFAULT_PROP_COLLIDER_SPEC: PropColliderSpec = {
  widthRatio: 0.72,
  heightRatio: 0.3,
}

const PROP_COLLIDER_SPECS: Record<string, PropColliderSpec> = {
  "brazier-tower": { widthRatio: 0.8, heightRatio: 0.22 },
}

let WALKABLE_MASK = createMask()
let LAVA_MASK = createMask()
let CLIFF_MASK = createMask()
let WALKABLE_RECTS: readonly Rect[] = []
let NON_WALKABLE_RECTS: readonly Rect[] = []
let LAVA_RECTS: readonly Rect[] = []
let CLIFF_RECTS: readonly Rect[] = []

function createMask(fill = 0): Mask {
  return {
    data: new Uint8Array(ARENA_WIDTH * ARENA_HEIGHT).fill(fill),
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
  }
}

function maskIndex(x: number, y: number): number {
  return y * ARENA_WIDTH + x
}

function bitmapIndex(width: number, x: number, y: number): number {
  return y * width + x
}

function createSizedMask(width: number, height: number, fill = 0): Mask {
  return {
    data: new Uint8Array(width * height).fill(fill),
    width,
    height,
  }
}

function fillEllipse(mask: Mask, cx: number, cy: number, rx: number, ry: number): void {
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(mask.width - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(mask.height - 1, Math.ceil(cy + ry))
  const rxSq = rx * rx
  const rySq = ry * ry
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      const dy = y - cy
      if ((dx * dx) / rxSq + (dy * dy) / rySq <= 1) {
        mask.data[maskIndex(x, y)] = 1
      }
    }
  }
}

function fillPolygon(mask: Mask, points: readonly { x: number; y: number }[]): void {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))))
  const maxY = Math.min(mask.height - 1, Math.ceil(Math.max(...points.map((p) => p.y))))
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = []
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        intersections.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
      }
    }
    intersections.sort((a, b) => a - b)
    for (let i = 0; i < intersections.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(intersections[i] ?? 0))
      const x1 = Math.min(mask.width - 1, Math.floor(intersections[i + 1] ?? -1))
      for (let x = x0; x <= x1; x++) {
        mask.data[maskIndex(x, y)] = 1
      }
    }
  }
}

function fillRotatedRect(
  mask: Mask,
  cx: number,
  cy: number,
  width: number,
  height: number,
  degrees: number,
): void {
  const theta = (degrees * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const hw = width / 2
  const hh = height / 2
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }))
  fillPolygon(mask, corners)
}

function drawWalkableMask(mask: Mask): void {
  fillEllipse(mask, 701, 558, 468, 312)
  fillPolygon(mask, [
    { x: 666, y: 124 },
    { x: 737, y: 124 },
    { x: 737, y: 252 },
    { x: 666, y: 252 },
  ])
  fillPolygon(mask, [
    { x: 646, y: 786 },
    { x: 765, y: 786 },
    { x: 765, y: 1084 },
    { x: 646, y: 1084 },
  ])
  fillPolygon(mask, [
    { x: 0, y: 538 },
    { x: 245, y: 538 },
    { x: 245, y: 528 },
    { x: 432, y: 528 },
    { x: 432, y: 606 },
    { x: 245, y: 606 },
    { x: 245, y: 594 },
    { x: 0, y: 594 },
  ])
  fillPolygon(mask, [
    { x: 970, y: 528 },
    { x: 1158, y: 528 },
    { x: 1158, y: 538 },
    { x: 1402, y: 538 },
    { x: 1402, y: 594 },
    { x: 1158, y: 594 },
    { x: 1158, y: 606 },
    { x: 970, y: 606 },
  ])

  fillEllipse(mask, 164, 151, 128, 94)
  fillEllipse(mask, 1238, 151, 128, 94)
  fillRotatedRect(mask, 312, 259, 182, 54, 43)
  fillRotatedRect(mask, 1090, 259, 182, 54, -43)

  fillEllipse(mask, 103, 394, 103, 76)
  fillEllipse(mask, 1299, 394, 103, 76)
  fillPolygon(mask, [
    { x: 72, y: 470 },
    { x: 130, y: 470 },
    { x: 150, y: 538 },
    { x: 50, y: 538 },
  ])
  fillPolygon(mask, [
    { x: 1272, y: 470 },
    { x: 1330, y: 470 },
    { x: 1352, y: 538 },
    { x: 1252, y: 538 },
  ])

  fillEllipse(mask, 171, 858, 106, 91)
  fillEllipse(mask, 1231, 858, 106, 91)
  fillRotatedRect(mask, 319, 785, 178, 56, -34)
  fillRotatedRect(mask, 1083, 785, 178, 56, 34)
  fillRotatedRect(mask, 62, 986, 156, 54, -48)
  fillRotatedRect(mask, 1340, 986, 156, 54, 48)
}

function isLavaSeed(r: number, g: number, b: number): boolean {
  return r >= 118 && g >= 24 && g <= 165 && b <= 78 && r - g >= 38 && g - b >= 8
}

function integralMask(mask: Mask): Uint32Array {
  const stride = mask.width + 1
  const integral = new Uint32Array((mask.width + 1) * (mask.height + 1))
  for (let y = 0; y < mask.height; y++) {
    let row = 0
    for (let x = 0; x < mask.width; x++) {
      row += mask.data[maskIndex(x, y)] ?? 0
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + row
    }
  }
  return integral
}

function countInIntegral(
  integral: Uint32Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const stride = width + 1
  return (
    integral[y1 * stride + x1]! -
    integral[y0 * stride + x1]! -
    integral[y1 * stride + x0]! +
    integral[y0 * stride + x0]!
  )
}

function dilateMask(mask: Mask, iterations: number): Mask {
  let current = mask.data
  for (let step = 0; step < iterations; step++) {
    const next = current.slice()
    for (let y = 1; y < mask.height - 1; y++) {
      for (let x = 1; x < mask.width - 1; x++) {
        const i = maskIndex(x, y)
        if (current[i]) continue
        if (
          current[i - 1] ||
          current[i + 1] ||
          current[i - mask.width] ||
          current[i + mask.width] ||
          current[i - mask.width - 1] ||
          current[i - mask.width + 1] ||
          current[i + mask.width - 1] ||
          current[i + mask.width + 1]
        ) {
          next[i] = 1
        }
      }
    }
    current = next
  }
  return { data: current, width: mask.width, height: mask.height }
}

function erodeMask(mask: Mask, iterations: number): Mask {
  let current = mask.data
  for (let step = 0; step < iterations; step++) {
    const next = current.slice()
    for (let y = 1; y < mask.height - 1; y++) {
      for (let x = 1; x < mask.width - 1; x++) {
        const i = maskIndex(x, y)
        if (!current[i]) continue
        if (
          !current[i - 1] ||
          !current[i + 1] ||
          !current[i - mask.width] ||
          !current[i + mask.width] ||
          !current[i - mask.width - 1] ||
          !current[i - mask.width + 1] ||
          !current[i + mask.width - 1] ||
          !current[i + mask.width + 1]
        ) {
          next[i] = 0
        }
      }
    }
    current = next
  }
  return { data: current, width: mask.width, height: mask.height }
}

function retainLargeComponents(mask: Mask, minArea: number): Mask {
  const seen = new Uint8Array(mask.data.length)
  const out = createMask()
  const q = new Int32Array(mask.data.length)
  const component: number[] = []
  for (let start = 0; start < mask.data.length; start++) {
    if (!mask.data[start] || seen[start]) continue
    let head = 0
    let tail = 0
    let touchesEdge = false
    component.length = 0
    q[tail++] = start
    seen[start] = 1
    while (head < tail) {
      const i = q[head++]!
      component.push(i)
      const x = i % mask.width
      const y = Math.floor(i / mask.width)
      if (x <= 1 || y <= 1 || x >= mask.width - 2 || y >= mask.height - 2) touchesEdge = true
      const neighbors = [i - 1, i + 1, i - mask.width, i + mask.width]
      for (const n of neighbors) {
        if (n < 0 || n >= mask.data.length || seen[n] || !mask.data[n]) continue
        const nx = n % mask.width
        if (Math.abs(nx - x) > 1) continue
        seen[n] = 1
        q[tail++] = n
      }
    }
    if (component.length >= minArea || touchesEdge) {
      for (const i of component) out.data[i] = 1
    }
  }
  return out
}

function buildLavaMask(base: RawImage, walkable: Mask): Mask {
  const seed = createMask()
  for (let i = 0, p = 0; i < seed.data.length; i++, p += 4) {
    if (walkable.data[i]) continue
    if (isLavaSeed(base.data[p]!, base.data[p + 1]!, base.data[p + 2]!)) {
      seed.data[i] = 1
    }
  }
  const integral = integralMask(seed)
  const dense = createMask()
  const radius = 10
  for (let y = 0; y < ARENA_HEIGHT; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(ARENA_HEIGHT, y + radius + 1)
    for (let x = 0; x < ARENA_WIDTH; x++) {
      const i = maskIndex(x, y)
      if (walkable.data[i]) continue
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(ARENA_WIDTH, x + radius + 1)
      if (countInIntegral(integral, ARENA_WIDTH, x0, y0, x1, y1) >= 30) {
        dense.data[i] = 1
      }
    }
  }
  const closed = erodeMask(dilateMask(dense, 8), 3)
  const lava = retainLargeComponents(closed, 1600)
  const nonLavaStone = createMask()
  fillEllipse(nonLavaStone, 452, 990, 92, 58)
  fillEllipse(nonLavaStone, 950, 990, 92, 58)
  fillPolygon(nonLavaStone, [
    { x: 612, y: 0 },
    { x: 790, y: 0 },
    { x: 790, y: 166 },
    { x: 612, y: 166 },
  ])
  for (let i = 0; i < lava.data.length; i++) {
    if (walkable.data[i] || nonLavaStone.data[i]) lava.data[i] = 0
  }
  return lava
}

function buildCliffMask(walkable: Mask, lava: Mask): Mask {
  const cliff = createMask()
  for (let i = 0; i < cliff.data.length; i++) {
    cliff.data[i] = !walkable.data[i] && !lava.data[i] ? 1 : 0
  }
  return cliff
}

async function loadMaskImage(fileName: string): Promise<Mask> {
  const path = resolve(MASK_DIR, fileName)
  const image = sharp(path).ensureAlpha()
  const meta = await image.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width !== ARENA_WIDTH || height !== ARENA_HEIGHT) {
    throw new Error(`${path} must be ${ARENA_WIDTH}x${ARENA_HEIGHT}, got ${width}x${height}.`)
  }
  const raw = await image.raw().toBuffer()
  const mask = createMask()
  for (let i = 0, p = 0; i < mask.data.length; i++, p += 4) {
    const r = raw[p]!
    const g = raw[p + 1]!
    const b = raw[p + 2]!
    const a = raw[p + 3]!
    mask.data[i] = a > 0 && (r + g + b) / 3 >= 128 ? 1 : 0
  }
  return mask
}

function isWalkableGuideStroke(r: number, g: number, b: number, a: number): boolean {
  return a > 120 && g >= 70 && r <= 105 && b <= 120 && g - r >= 18 && g - b >= 8
}

function dilateBitmapMask(mask: Mask, iterations: number): Mask {
  let current = mask.data
  for (let step = 0; step < iterations; step++) {
    const next = current.slice()
    for (let y = 1; y < mask.height - 1; y++) {
      for (let x = 1; x < mask.width - 1; x++) {
        const i = bitmapIndex(mask.width, x, y)
        if (current[i]) continue
        if (
          current[i - 1] ||
          current[i + 1] ||
          current[i - mask.width] ||
          current[i + mask.width] ||
          current[i - mask.width - 1] ||
          current[i - mask.width + 1] ||
          current[i + mask.width - 1] ||
          current[i + mask.width + 1]
        ) {
          next[i] = 1
        }
      }
    }
    current = next
  }
  return { data: current, width: mask.width, height: mask.height }
}

function floodOutsideBarrier(barrier: Mask): Mask {
  const outside = createSizedMask(barrier.width, barrier.height)
  const queue = new Int32Array(barrier.data.length)
  let head = 0
  let tail = 0

  const push = (i: number): void => {
    if (i < 0 || i >= outside.data.length || outside.data[i] || barrier.data[i]) return
    outside.data[i] = 1
    queue[tail++] = i
  }

  for (let x = 0; x < barrier.width; x++) {
    push(bitmapIndex(barrier.width, x, 0))
    push(bitmapIndex(barrier.width, x, barrier.height - 1))
  }
  for (let y = 0; y < barrier.height; y++) {
    push(bitmapIndex(barrier.width, 0, y))
    push(bitmapIndex(barrier.width, barrier.width - 1, y))
  }

  while (head < tail) {
    const i = queue[head++]!
    const x = i % barrier.width
    const y = Math.floor(i / barrier.width)
    if (x > 0) push(i - 1)
    if (x < barrier.width - 1) push(i + 1)
    if (y > 0) push(i - barrier.width)
    if (y < barrier.height - 1) push(i + barrier.width)
  }

  return outside
}

function fillClosedGuideRegions(stroke: Mask, barrierDilation: number): Mask {
  const barrier = dilateBitmapMask(stroke, barrierDilation)
  const outside = floodOutsideBarrier(barrier)
  const filled = createSizedMask(stroke.width, stroke.height)
  for (let i = 0; i < filled.data.length; i++) {
    filled.data[i] = !outside.data[i] && !barrier.data[i] ? 1 : 0
  }
  return filled
}

function unionMasks(a: Mask, b: Mask): Mask {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Cannot union masks with different dimensions: ${a.width}x${a.height} vs ${b.width}x${b.height}.`)
  }
  const out = createSizedMask(a.width, a.height)
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = a.data[i] || b.data[i] ? 1 : 0
  }
  return out
}

function scaleGuideMaskToArena(source: Mask): Mask {
  const scaled = createMask()
  for (let y = 0; y < ARENA_HEIGHT; y++) {
    const sourceY = Math.min(source.height - 1, Math.floor((y + 0.5) * (source.height / ARENA_HEIGHT)))
    for (let x = 0; x < ARENA_WIDTH; x++) {
      const sourceX = Math.min(source.width - 1, Math.floor((x + 0.5) * (source.width / ARENA_WIDTH)))
      scaled.data[maskIndex(x, y)] = source.data[bitmapIndex(source.width, sourceX, sourceY)] ?? 0
    }
  }
  return scaled
}

function paintGuideWalkablePatches(mask: Mask): void {
  // The north doorway guide stroke leaves an upside-down U-shaped gap in front
  // of the door. This fills the intended stair landing inside the rail outline.
  fillPolygon(mask, [
    { x: 684, y: 143 },
    { x: 720, y: 143 },
    { x: 735, y: 164 },
    { x: 735, y: 234 },
    { x: 669, y: 234 },
    { x: 669, y: 164 },
  ])

  // The hand line leaves a tiny open seam where the north stair meets the
  // arena ring; fill only that join so the guide shape remains authoritative.
  fillPolygon(mask, [
    { x: 675, y: 226 },
    { x: 731, y: 226 },
    { x: 731, y: 258 },
    { x: 675, y: 258 },
  ])

  // The guide outlines the bottom stair hub with an open lower edge; this
  // patch fills that intended walkable terminal after the guide-derived fill.
  fillPolygon(mask, [
    { x: 675, y: 885 },
    { x: 731, y: 885 },
    { x: 731, y: 998 },
    { x: 761, y: 1014 },
    { x: 772, y: 1040 },
    { x: 747, y: 1064 },
    { x: 657, y: 1064 },
    { x: 632, y: 1040 },
    { x: 643, y: 1014 },
    { x: 675, y: 998 },
  ])
  fillPolygon(mask, [
    { x: 650, y: 982 },
    { x: 676, y: 982 },
    { x: 676, y: 1004 },
    { x: 650, y: 1004 },
  ])
  fillPolygon(mask, [
    { x: 674, y: 1038 },
    { x: 730, y: 1038 },
    { x: 730, y: ARENA_HEIGHT },
    { x: 674, y: ARENA_HEIGHT },
  ])
}

function componentFromPoint(mask: Mask, startX: number, startY: number): Uint8Array {
  const reachable = new Uint8Array(mask.data.length)
  const start = maskIndex(startX, startY)
  if (!mask.data[start]) return reachable
  const queue = new Int32Array(mask.data.length)
  let head = 0
  let tail = 0
  reachable[start] = 1
  queue[tail++] = start
  while (head < tail) {
    const i = queue[head++]!
    const x = i % ARENA_WIDTH
    const y = Math.floor(i / ARENA_WIDTH)
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < ARENA_WIDTH - 1 ? i + 1 : -1,
      y > 0 ? i - ARENA_WIDTH : -1,
      y < ARENA_HEIGHT - 1 ? i + ARENA_WIDTH : -1,
    ]
    for (const n of neighbors) {
      if (n < 0 || reachable[n] || !mask.data[n]) continue
      reachable[n] = 1
      queue[tail++] = n
    }
  }
  return reachable
}

function assertWalkableGuideTopology(mask: Mask): void {
  const main = componentFromPoint(mask, 701, 558)
  const shouldReach = [
    ["west bridge", 140, 570],
    ["east bridge", 1262, 570],
    ["north stair", 703, 225],
    ["south stair", 703, 945],
    ["top-left pad", 164, 151],
    ["top-right pad", 1238, 151],
    ["bottom-left pad", 171, 858],
    ["bottom-right pad", 1231, 858],
  ] as const
  const shouldStaySeparate = [
    ["left side jump island", 103, 423],
    ["right side jump island", 1299, 423],
    ["bottom-left jump island", 452, 990],
    ["bottom-right jump island", 950, 990],
    ["top-left tiny island", 409, 34],
    ["top-right tiny island", 993, 34],
    ["left castle ledge", 585, 150],
    ["right castle ledge", 817, 150],
  ] as const

  const errors: string[] = []
  for (const [label, x, y] of shouldReach) {
    const i = maskIndex(x, y)
    if (!mask.data[i]) {
      errors.push(`${label} sample (${x}, ${y}) is not walkable`)
    } else if (!main[i]) {
      errors.push(`${label} sample (${x}, ${y}) is not connected to the main arena`)
    }
  }
  for (const [label, x, y] of shouldStaySeparate) {
    const i = maskIndex(x, y)
    if (!mask.data[i]) {
      errors.push(`${label} sample (${x}, ${y}) is not walkable`)
    } else if (main[i]) {
      errors.push(`${label} sample (${x}, ${y}) leaked into the main connected component`)
    }
  }
  if (errors.length > 0) {
    throw new Error(`Guide-derived walkable topology failed:\n${errors.map((error) => `- ${error}`).join("\n")}`)
  }
}

async function loadGuideWalkableMask(): Promise<Mask> {
  const image = sharp(SOURCE_WALKABLE_GUIDE).ensureAlpha()
  const meta = await image.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width <= 0 || height <= 0) {
    throw new Error(`${SOURCE_WALKABLE_GUIDE} could not be read as a walkable guide image.`)
  }
  if (width !== WALKABLE_GUIDE_WIDTH || height !== WALKABLE_GUIDE_HEIGHT) {
    throw new Error(
      `${SOURCE_WALKABLE_GUIDE} must be the annotated full-map guide at ` +
        `${WALKABLE_GUIDE_WIDTH}x${WALKABLE_GUIDE_HEIGHT}; got ${width}x${height}.`,
    )
  }
  const raw = await image.raw().toBuffer()
  const stroke = createSizedMask(width, height)
  let strokePixels = 0
  for (let i = 0, p = 0; i < stroke.data.length; i++, p += 4) {
    if (isWalkableGuideStroke(raw[p]!, raw[p + 1]!, raw[p + 2]!, raw[p + 3]!)) {
      stroke.data[i] = 1
      strokePixels++
    }
  }
  if (strokePixels < 1000) {
    throw new Error(`${SOURCE_WALKABLE_GUIDE} did not contain enough green guide pixels; found ${strokePixels}.`)
  }

  const preciseFill = fillClosedGuideRegions(stroke, 2)
  const gapTolerantFill = fillClosedGuideRegions(stroke, 4)
  const guideBoundary = dilateBitmapMask(stroke, 2)
  const combinedGuideFill = unionMasks(unionMasks(preciseFill, gapTolerantFill), guideBoundary)
  const walkable = scaleGuideMaskToArena(combinedGuideFill)
  paintGuideWalkablePatches(walkable)
  assertWalkableGuideTopology(walkable)
  return walkable
}

function assertExclusiveMasks(masks: {
  readonly walkable: Mask
  readonly lava: Mask
  readonly cliff: Mask
}): void {
  let overlap = 0
  let empty = 0
  for (let i = 0; i < ARENA_WIDTH * ARENA_HEIGHT; i++) {
    const count = (masks.walkable.data[i] ?? 0) + (masks.lava.data[i] ?? 0) + (masks.cliff.data[i] ?? 0)
    if (count > 1) overlap++
    if (count === 0) empty++
  }
  if (overlap > 0) {
    throw new Error(`Arena source masks must be mutually exclusive; found ${overlap} overlapping pixels.`)
  }
  if (empty > 0) {
    throw new Error(`Arena source masks must classify every pixel; found ${empty} unclassified pixels.`)
  }
}

function classifiedGridFromMasks(
  masks: {
    readonly walkable: Mask
    readonly lava: Mask
    readonly cliff: Mask
  },
  cellSize: number,
): ClassifiedGrid {
  const cols = Math.ceil(ARENA_WIDTH / cellSize)
  const rows = Math.ceil(ARENA_HEIGHT / cellSize)
  const cells = new Uint8Array(cols * rows)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cellSize
      const y0 = row * cellSize
      const x1 = Math.min(ARENA_WIDTH, x0 + cellSize)
      const y1 = Math.min(ARENA_HEIGHT, y0 + cellSize)
      let walkable = 0
      let lava = 0
      let cliff = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = maskIndex(x, y)
          walkable += masks.walkable.data[i] ?? 0
          lava += masks.lava.data[i] ?? 0
          cliff += masks.cliff.data[i] ?? 0
        }
      }
      let klass = REGION_WALKABLE
      let count = walkable
      if (lava > count) {
        klass = REGION_LAVA
        count = lava
      }
      if (cliff > count) {
        klass = REGION_CLIFF
        count = cliff
      }
      cells[row * cols + col] = count > 0 ? klass : REGION_NONE
    }
  }
  return { cells, cols, rows, cellSize }
}

function rectsFromClassifiedGrid(grid: ClassifiedGrid, klass: RegionClass): Rect[] {
  const horizontal: Rect[] = []
  for (let row = 0; row < grid.rows; row++) {
    let col = 0
    while (col < grid.cols) {
      if (grid.cells[row * grid.cols + col] !== klass) {
        col++
        continue
      }
      const start = col
      while (col < grid.cols && grid.cells[row * grid.cols + col] === klass) col++
      horizontal.push({
        x: start * grid.cellSize,
        y: row * grid.cellSize,
        width: Math.min(ARENA_WIDTH, col * grid.cellSize) - start * grid.cellSize,
        height: Math.min(grid.cellSize, ARENA_HEIGHT - row * grid.cellSize),
      })
    }
  }

  horizontal.sort((a, b) => a.x - b.x || a.width - b.width || a.y - b.y)
  const merged: Rect[] = []
  for (const rect of horizontal) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.x === rect.x &&
      last.width === rect.width &&
      last.y + last.height === rect.y
    ) {
      last.height += rect.height
    } else {
      merged.push({ ...rect })
    }
  }

  return merged.sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height)
}

function cloneMask(mask: Mask): Mask {
  return { data: mask.data.slice(), width: mask.width, height: mask.height }
}

function isBasePixelLavaLike(base: RawImage, x: number, y: number): boolean {
  const p = (y * base.width + x) * 4
  const r = base.data[p]!
  const g = base.data[p + 1]!
  const b = base.data[p + 2]!
  return isLavaSeed(r, g, b) || (r >= 95 && g >= 18 && b <= 88 && r - g >= 24 && g - b >= 4)
}

function satellitePlatformTopMask(centerX: number): Mask {
  const mask = createMask()
  const mirror = centerX < ARENA_WIDTH / 2 ? 1 : -1
  const points = [
    { dx: -96, y: 392 },
    { dx: -70, y: 371 },
    { dx: -35, y: 359 },
    { dx: 0, y: 356 },
    { dx: 34, y: 361 },
    { dx: 56, y: 376 },
    { dx: 63, y: 396 },
    { dx: 52, y: 418 },
    { dx: 20, y: 426 },
    { dx: -65, y: 426 },
    { dx: -96, y: 410 },
  ].map(({ dx, y }) => ({ x: centerX + mirror * dx, y }))
  fillPolygon(mask, points)
  return mask
}

function refineSideSatellitePlatformMasks(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  base: RawImage,
  centerX: number,
): void {
  const x0 = Math.max(0, Math.floor(centerX - 120))
  const x1 = Math.min(ARENA_WIDTH - 1, Math.ceil(centerX + 120))
  const y0 = 320
  const y1 = 484
  const platformTop = satellitePlatformTopMask(centerX)

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = maskIndex(x, y)
      const wasWalkable = masks.walkable.data[i] === 1
      if (platformTop.data[i]) {
        masks.walkable.data[i] = 1
        masks.lava.data[i] = 0
        masks.cliff.data[i] = 0
        continue
      }

      if (!wasWalkable) continue

      masks.walkable.data[i] = 0
      if (isBasePixelLavaLike(base, x, y)) {
        masks.lava.data[i] = 1
        masks.cliff.data[i] = 0
      } else {
        masks.lava.data[i] = 0
        masks.cliff.data[i] = 1
      }
    }
  }
}

function applyComputerVisionGuidedMaskRefinements(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  base: RawImage,
): void {
  // The side satellite platforms cannot be represented by a full ellipse: the
  // visible front wall is a cliff face. This CV-calibrated mask keeps only the
  // detected top stone deck and returns the remaining crop pixels to lava/cliff.
  refineSideSatellitePlatformMasks(masks, base, 103)
  refineSideSatellitePlatformMasks(masks, base, 1299)
}

function paintWalkablePolygon(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  points: readonly { x: number; y: number }[],
): void {
  const patch = createMask()
  fillPolygon(patch, points)
  for (let i = 0; i < patch.data.length; i++) {
    if (!patch.data[i]) continue
    masks.walkable.data[i] = 1
    masks.lava.data[i] = 0
    masks.cliff.data[i] = 0
  }
}

function paintWalkableEllipse(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  const patch = createMask()
  fillEllipse(patch, cx, cy, rx, ry)
  for (let i = 0; i < patch.data.length; i++) {
    if (!patch.data[i]) continue
    masks.walkable.data[i] = 1
    masks.lava.data[i] = 0
    masks.cliff.data[i] = 0
  }
}

function paintWalkableEllipseInRect(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rect: Rect,
): void {
  const patch = createMask()
  fillEllipse(patch, cx, cy, rx, ry)
  const minX = Math.max(0, Math.floor(rect.x))
  const maxX = Math.min(ARENA_WIDTH - 1, Math.ceil(rect.x + rect.width))
  const minY = Math.max(0, Math.floor(rect.y))
  const maxY = Math.min(ARENA_HEIGHT - 1, Math.ceil(rect.y + rect.height))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = maskIndex(x, y)
      if (!patch.data[i]) continue
      masks.walkable.data[i] = 1
      masks.lava.data[i] = 0
      masks.cliff.data[i] = 0
    }
  }
}

function paintWalkableRotatedRect(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  cx: number,
  cy: number,
  width: number,
  height: number,
  degrees: number,
): void {
  const patch = createMask()
  fillRotatedRect(patch, cx, cy, width, height, degrees)
  for (let i = 0; i < patch.data.length; i++) {
    if (!patch.data[i]) continue
    masks.walkable.data[i] = 1
    masks.lava.data[i] = 0
    masks.cliff.data[i] = 0
  }
}

function reclassifyPatchFromBase(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  base: RawImage,
  patch: Mask,
): void {
  for (let y = 0; y < ARENA_HEIGHT; y++) {
    for (let x = 0; x < ARENA_WIDTH; x++) {
      const i = maskIndex(x, y)
      if (!patch.data[i]) continue
      masks.walkable.data[i] = 0
      if (isBasePixelLavaLike(base, x, y)) {
        masks.lava.data[i] = 1
        masks.cliff.data[i] = 0
      } else {
        masks.lava.data[i] = 0
        masks.cliff.data[i] = 1
      }
    }
  }
}

function replaceWalkablePolygon(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  base: RawImage,
  clearPoints: readonly { x: number; y: number }[],
  walkablePoints: readonly { x: number; y: number }[],
): void {
  const patch = createMask()
  fillPolygon(patch, clearPoints)
  reclassifyPatchFromBase(masks, base, patch)
  paintWalkablePolygon(masks, walkablePoints)
}

function reclassifyPolygonFromBase(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  base: RawImage,
  points: readonly { x: number; y: number }[],
): void {
  const patch = createMask()
  fillPolygon(patch, points)
  reclassifyPatchFromBase(masks, base, patch)
}

function clearWalkableRect(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  base: RawImage,
  rect: Rect,
): void {
  reclassifyPolygonFromBase(masks, base, [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ])
}

function mirrorPointsX(points: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  return points.map((point) => ({ x: ARENA_WIDTH - point.x, y: point.y }))
}

function applyUserGuideWalkableReplacements(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  base: RawImage,
): void {
  // User-provided guide crop is native scale. These replacements intentionally
  // clear old broad patches in marked ROIs before repainting the guided deck.
  for (const [rect, cx, cy, rx, ry] of [
    [{ x: 40, y: 68, width: 270, height: 188 }, 164, 158, 112, 80],
    [{ x: 1092, y: 68, width: 270, height: 188 }, 1238, 158, 112, 80],
    [{ x: 320, y: 0, width: 160, height: 90 }, 393, 43, 40, 24],
    [{ x: 922, y: 0, width: 160, height: 90 }, 1009, 43, 40, 24],
    [{ x: 0, y: 324, width: 220, height: 164 }, 104, 423, 66, 45],
    [{ x: 1182, y: 324, width: 220, height: 164 }, 1298, 423, 66, 45],
  ] as const) {
    clearWalkableRect(masks, base, rect)
    paintWalkableEllipse(masks, cx, cy, rx, ry)
  }

  for (const rect of [
    { x: 0, y: 488, width: 282, height: 134 },
    { x: 1120, y: 488, width: 282, height: 134 },
  ] as const) {
    clearWalkableRect(masks, base, rect)
  }
  const leftHorizontalBridge = [
    { x: 0, y: 544 },
    { x: 20, y: 544 },
    { x: 38, y: 552 },
    { x: 252, y: 552 },
    { x: 252, y: 588 },
    { x: 38, y: 588 },
    { x: 20, y: 610 },
    { x: 0, y: 602 },
    { x: 12, y: 584 },
    { x: 0, y: 570 },
  ] as const
  paintWalkablePolygon(masks, leftHorizontalBridge)
  paintWalkablePolygon(masks, mirrorPointsX(leftHorizontalBridge))

  clearWalkableRect(masks, base, { x: 500, y: 76, width: 402, height: 176 })
  const leftCastleTerrace = [
    { x: 572, y: 94 },
    { x: 555, y: 104 },
    { x: 545, y: 112 },
    { x: 536, y: 120 },
    { x: 532, y: 128 },
    { x: 530, y: 138 },
    { x: 532, y: 146 },
    { x: 540, y: 154 },
    { x: 553, y: 164 },
    { x: 570, y: 178 },
    { x: 595, y: 196 },
    { x: 614, y: 205 },
    { x: 664, y: 225 },
    { x: 664, y: 198 },
    { x: 648, y: 195 },
    { x: 636, y: 193 },
    { x: 624, y: 187 },
    { x: 612, y: 178 },
    { x: 600, y: 172 },
    { x: 588, y: 167 },
    { x: 583, y: 157 },
    { x: 574, y: 150 },
  ] as const
  paintWalkablePolygon(masks, leftCastleTerrace)
  paintWalkablePolygon(masks, mirrorPointsX(leftCastleTerrace))
  paintWalkablePolygon(masks, [
    { x: 676, y: 248 },
    { x: 731, y: 248 },
    { x: 731, y: 164 },
    { x: 710, y: 154 },
    { x: 691, y: 154 },
    { x: 676, y: 198 },
  ])

  const topArenaBandClear = [
    { x: 390, y: 244 },
    { x: 1012, y: 244 },
    { x: 1012, y: 348 },
    { x: 390, y: 348 },
  ] as const
  const topArenaBand = [
    { x: 395, y: 336 },
    { x: 425, y: 315 },
    { x: 460, y: 299 },
    { x: 500, y: 283 },
    { x: 547, y: 267 },
    { x: 620, y: 251 },
    { x: 767, y: 251 },
    { x: 857, y: 267 },
    { x: 909, y: 283 },
    { x: 923, y: 336 },
    { x: 923, y: 348 },
    { x: 395, y: 348 },
  ] as const
  reclassifyPolygonFromBase(masks, base, topArenaBandClear)
  paintWalkablePolygon(masks, topArenaBand)
  paintWalkablePolygon(masks, [
    { x: 676, y: 248 },
    { x: 731, y: 248 },
    { x: 731, y: 164 },
    { x: 710, y: 154 },
    { x: 691, y: 154 },
    { x: 676, y: 198 },
  ])

  const leftArenaJoinClear = [
    { x: 228, y: 320 },
    { x: 504, y: 320 },
    { x: 504, y: 626 },
    { x: 228, y: 626 },
  ] as const
  const leftArenaJoin = [
    { x: 254, y: 626 },
    { x: 504, y: 626 },
    { x: 504, y: 282 },
    { x: 460, y: 299 },
    { x: 425, y: 315 },
    { x: 397, y: 336 },
    { x: 362, y: 358 },
    { x: 334, y: 384 },
    { x: 312, y: 410 },
    { x: 294, y: 436 },
    { x: 280, y: 462 },
    { x: 267, y: 488 },
    { x: 259, y: 514 },
    { x: 250, y: 540 },
    { x: 248, y: 586 },
  ] as const
  reclassifyPolygonFromBase(masks, base, leftArenaJoinClear)
  reclassifyPolygonFromBase(masks, base, mirrorPointsX(leftArenaJoinClear))

  const leftDiagonalClear = [
    { x: 190, y: 176 },
    { x: 458, y: 176 },
    { x: 458, y: 392 },
    { x: 182, y: 392 },
    { x: 182, y: 218 },
  ] as const
  const leftDiagonalBridge = [
    { x: 254, y: 208 },
    { x: 267, y: 228 },
    { x: 281, y: 248 },
    { x: 300, y: 268 },
    { x: 328, y: 288 },
    { x: 356, y: 308 },
    { x: 393, y: 336 },
    { x: 362, y: 360 },
    { x: 346, y: 340 },
    { x: 333, y: 330 },
    { x: 320, y: 320 },
    { x: 307, y: 310 },
    { x: 294, y: 300 },
    { x: 281, y: 290 },
    { x: 267, y: 280 },
    { x: 256, y: 265 },
    { x: 245, y: 250 },
    { x: 231, y: 233 },
  ] as const
  reclassifyPolygonFromBase(masks, base, leftDiagonalClear)
  reclassifyPolygonFromBase(masks, base, mirrorPointsX(leftDiagonalClear))
  paintWalkablePolygon(masks, leftArenaJoin)
  paintWalkablePolygon(masks, mirrorPointsX(leftArenaJoin))
  paintWalkablePolygon(masks, leftDiagonalBridge)
  paintWalkablePolygon(masks, mirrorPointsX(leftDiagonalBridge))
  paintWalkableEllipse(masks, 164, 158, 112, 80)
  paintWalkableEllipse(masks, 1238, 158, 112, 80)
  paintWalkablePolygon(masks, leftHorizontalBridge)
  paintWalkablePolygon(masks, mirrorPointsX(leftHorizontalBridge))
}

function applyWalkableSurfaceCompletion(
  masks: { walkable: Mask; lava: Mask; cliff: Mask },
  base: RawImage,
): void {
  // These patches are calibrated from the base art after the broad masks are
  // loaded. They fill walkable stone deck surfaces that the first pass misses:
  // small jump islands, circular side decks, and connector seams.
  for (const [cx, cy, rx, ry] of [
    [452, 990, 80, 52],
    [950, 990, 80, 52],
    [409, 34, 64, 30],
    [993, 34, 64, 30],
  ] as const) {
    paintWalkableEllipse(masks, cx, cy, rx, ry)
  }

  for (const points of [
    [
      { x: 0, y: 383 },
      { x: 16, y: 363 },
      { x: 52, y: 344 },
      { x: 96, y: 337 },
      { x: 139, y: 342 },
      { x: 176, y: 359 },
      { x: 205, y: 386 },
      { x: 205, y: 413 },
      { x: 181, y: 439 },
      { x: 137, y: 454 },
      { x: 87, y: 454 },
      { x: 38, y: 443 },
      { x: 6, y: 420 },
      { x: 0, y: 407 },
    ],
    [
      { x: 1402, y: 383 },
      { x: 1386, y: 363 },
      { x: 1350, y: 344 },
      { x: 1306, y: 337 },
      { x: 1263, y: 342 },
      { x: 1226, y: 359 },
      { x: 1197, y: 386 },
      { x: 1197, y: 413 },
      { x: 1221, y: 439 },
      { x: 1265, y: 454 },
      { x: 1315, y: 454 },
      { x: 1364, y: 443 },
      { x: 1396, y: 420 },
      { x: 1402, y: 407 },
    ],
    [
      { x: 68, y: 452 },
      { x: 132, y: 452 },
      { x: 148, y: 540 },
      { x: 52, y: 540 },
    ],
    [
      { x: 1270, y: 452 },
      { x: 1334, y: 452 },
      { x: 1350, y: 540 },
      { x: 1254, y: 540 },
    ],
  ] as const) {
    paintWalkablePolygon(masks, points)
  }

  reclassifyPolygonFromBase(masks, base, [
    { x: 0, y: 324 },
    { x: 220, y: 324 },
    { x: 220, y: 586 },
    { x: 0, y: 586 },
  ])
  paintWalkableEllipse(masks, 103, 394, 104, 64)
  paintWalkablePolygon(masks, [
    { x: 64, y: 450 },
    { x: 136, y: 450 },
    { x: 156, y: 600 },
    { x: 40, y: 600 },
  ])

  reclassifyPolygonFromBase(masks, base, [
    { x: 1182, y: 324 },
    { x: 1402, y: 324 },
    { x: 1402, y: 586 },
    { x: 1182, y: 586 },
  ])
  paintWalkableEllipse(masks, 1299, 394, 104, 64)
  paintWalkablePolygon(masks, [
    { x: 1266, y: 450 },
    { x: 1338, y: 450 },
    { x: 1362, y: 600 },
    { x: 1246, y: 600 },
  ])

  for (const [cx, cy, width, height, degrees] of [
    [62, 986, 156, 54, -48],
    [1340, 986, 156, 54, 48],
  ] as const) {
    paintWalkableRotatedRect(masks, cx, cy, width, height, degrees)
  }

  replaceWalkablePolygon(
    masks,
    base,
    [
      { x: 214, y: 178 },
      { x: 448, y: 334 },
      { x: 400, y: 393 },
      { x: 188, y: 232 },
    ],
    [
      { x: 246, y: 191 },
      { x: 274, y: 200 },
      { x: 418, y: 338 },
      { x: 394, y: 361 },
      { x: 222, y: 220 },
      { x: 232, y: 202 },
    ],
  )
  replaceWalkablePolygon(
    masks,
    base,
    [
      { x: 1188, y: 178 },
      { x: 954, y: 334 },
      { x: 1002, y: 393 },
      { x: 1214, y: 232 },
    ],
    [
      { x: 1156, y: 191 },
      { x: 1128, y: 200 },
      { x: 984, y: 338 },
      { x: 1008, y: 361 },
      { x: 1180, y: 220 },
      { x: 1170, y: 202 },
    ],
  )
  replaceWalkablePolygon(
    masks,
    base,
    [
      { x: 240, y: 780 },
      { x: 450, y: 730 },
      { x: 472, y: 792 },
      { x: 285, y: 898 },
      { x: 210, y: 880 },
    ],
    [
      { x: 266, y: 819 },
      { x: 287, y: 807 },
      { x: 425, y: 759 },
      { x: 445, y: 775 },
      { x: 283, y: 867 },
      { x: 253, y: 856 },
    ],
  )
  replaceWalkablePolygon(
    masks,
    base,
    [
      { x: 1162, y: 780 },
      { x: 952, y: 730 },
      { x: 930, y: 792 },
      { x: 1117, y: 898 },
      { x: 1192, y: 880 },
    ],
    [
      { x: 1136, y: 819 },
      { x: 1115, y: 807 },
      { x: 977, y: 759 },
      { x: 957, y: 775 },
      { x: 1119, y: 867 },
      { x: 1149, y: 856 },
    ],
  )
  paintWalkableEllipseInRect(masks, 701, 558, 468, 312, {
    x: 0,
    y: 700,
    width: ARENA_WIDTH,
    height: 220,
  })
  paintWalkableEllipse(masks, 171, 858, 106, 91)
  paintWalkableEllipse(masks, 1231, 858, 106, 91)

  paintWalkablePolygon(masks, [
    { x: 636, y: 758 },
    { x: 776, y: 758 },
    { x: 776, y: 846 },
    { x: 636, y: 846 },
  ])
}

function applyCardinalConnectorUnions(masks: { walkable: Mask; lava: Mask; cliff: Mask }): void {
  for (const points of [
    [
      { x: 646, y: 248 },
      { x: 756, y: 248 },
      { x: 756, y: 274 },
      { x: 646, y: 274 },
    ],
    [
      { x: 626, y: 768 },
      { x: 786, y: 768 },
      { x: 786, y: 842 },
      { x: 626, y: 842 },
    ],
    [
      { x: 340, y: 528 },
      { x: 446, y: 528 },
      { x: 446, y: 606 },
      { x: 340, y: 606 },
    ],
    [
      { x: 956, y: 528 },
      { x: 1062, y: 528 },
      { x: 1062, y: 606 },
      { x: 956, y: 606 },
    ],
  ] as const) {
    paintWalkablePolygon(masks, points)
  }
}

function applyTopLeftFootprintClearance(mask: Mask): void {
  // Runtime collision uses a 40x18 oval footprint against AABB rectangles. The
  // visual bridge deck is narrower than the legal center path, so this grants
  // hidden clearance while visual `WalkableAreas` remains art-aligned.
  fillRotatedRect(mask, 323, 286, 252, 72, 43)
  fillPolygon(mask, [
    { x: 188, y: 176 },
    { x: 266, y: 184 },
    { x: 302, y: 224 },
    { x: 266, y: 258 },
    { x: 194, y: 238 },
  ])
  fillPolygon(mask, [
    { x: 350, y: 296 },
    { x: 438, y: 322 },
    { x: 458, y: 356 },
    { x: 424, y: 386 },
    { x: 360, y: 360 },
  ])
}

async function buildArenaGeometry(): Promise<void> {
  const base = await loadRaw(SOURCE_BASE)
  const walkable = await loadGuideWalkableMask()
  const lava = buildLavaMask(base, walkable)
  const cliff = buildCliffMask(walkable, lava)
  assertExclusiveMasks({ walkable, lava, cliff })
  const visualClassified = classifiedGridFromMasks({ walkable, lava, cliff }, REGION_CELL_PX)
  const movementWalkable = cloneMask(walkable)
  applyTopLeftFootprintClearance(movementWalkable)
  const runtimeLava = cloneMask(lava)
  const runtimeCliff = cloneMask(cliff)
  for (let i = 0; i < movementWalkable.data.length; i++) {
    if (!movementWalkable.data[i]) continue
    runtimeLava.data[i] = 0
    runtimeCliff.data[i] = 0
  }
  const classified = classifiedGridFromMasks(
    { walkable: movementWalkable, lava: runtimeLava, cliff: runtimeCliff },
    REGION_CELL_PX,
  )
  WALKABLE_MASK = walkable
  LAVA_MASK = lava
  CLIFF_MASK = cliff
  WALKABLE_RECTS = rectsFromClassifiedGrid(visualClassified, REGION_WALKABLE)
  NON_WALKABLE_RECTS = rectsFromClassifiedGrid(classified, REGION_LAVA)
    .concat(rectsFromClassifiedGrid(classified, REGION_CLIFF))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height)
  LAVA_RECTS = rectsFromClassifiedGrid(classified, REGION_LAVA)
  CLIFF_RECTS = rectsFromClassifiedGrid(classified, REGION_CLIFF)
}

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
  { x: 700, y: 930 },
] as const

function arenaOutputPlacements(): Placement[] {
  return PLACEMENTS.map(scaleArenaOutputPlacement)
}

function arenaOutputSpawns(): Array<{ x: number; y: number }> {
  return SPAWNS.map(scaleArenaOutputPoint)
}

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

async function loadRawResized(path: string, width: number, height: number): Promise<RawImage> {
  const data = await sharp(path)
    .ensureAlpha()
    .resize(width, height, { kernel: "nearest" })
    .raw()
    .toBuffer()
  return { data, width, height }
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
  const placements = arenaOutputPlacements()
  const composites: sharp.OverlayOptions[] = []
  const propFootprints: Rect[] = []
  for (const placement of placements) {
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
      width: Math.min(ARENA_OUTPUT_WIDTH, width + 16),
      height: Math.min(ARENA_OUTPUT_HEIGHT, height + 16),
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

  const target = await loadRawResized(SOURCE_TARGET, ARENA_OUTPUT_WIDTH, ARENA_OUTPUT_HEIGHT)
  const recon = await loadRaw(resolve(REVIEW_DIR, "reconstructed-map.png"))
  const diff = Buffer.alloc(ARENA_OUTPUT_WIDTH * ARENA_OUTPUT_HEIGHT * 4)
  const propMask = new Uint8Array(ARENA_OUTPUT_WIDTH * ARENA_OUTPUT_HEIGHT)
  for (const rect of propFootprints) {
    const x0 = Math.max(0, rect.x)
    const y0 = Math.max(0, rect.y)
    const x1 = Math.min(ARENA_OUTPUT_WIDTH, rect.x + rect.width)
    const y1 = Math.min(ARENA_OUTPUT_HEIGHT, rect.y + rect.height)
    for (let y = y0; y < y1; y++) {
      propMask.fill(1, y * ARENA_OUTPUT_WIDTH + x0, y * ARENA_OUTPUT_WIDTH + x1)
    }
  }

  for (let i = 0, p = 0; i < ARENA_OUTPUT_WIDTH * ARENA_OUTPUT_HEIGHT; i++, p += 4) {
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
  await sharp(diff, { raw: { width: ARENA_OUTPUT_WIDTH, height: ARENA_OUTPUT_HEIGHT, channels: 4 } })
    .png()
    .toFile(resolve(REVIEW_DIR, "reconstruction-diff.png"))
}

function numberedPlacementSvg(): Buffer {
  const labels = arenaOutputPlacements().map((placement, index) => {
    const label = String(index + 1)
    return `<g transform="translate(${placement.x} ${placement.y})"><circle r="12" fill="#ffe600" fill-opacity="0.88" stroke="#111111" stroke-width="2"/><text y="1" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#111111">${label}</text></g>`
  }).join("")
  return Buffer.from(`<svg width="${ARENA_OUTPUT_WIDTH}" height="${ARENA_OUTPUT_HEIGHT}" viewBox="0 0 ${ARENA_OUTPUT_WIDTH} ${ARENA_OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${labels}</svg>`)
}

function scaledColliderForPlacement(props: readonly PropDef[], placement: Placement, index: number): Rect & { name: string } {
  const prop = props.find((p) => p.id === placement.propId)
  if (!prop) throw new Error(`Unknown prop ${placement.propId}`)
  const spec = PROP_COLLIDER_SPECS[placement.propId] ?? DEFAULT_PROP_COLLIDER_SPEC
  const width = Math.max(8, Math.round(prop.width * placement.scale * spec.widthRatio))
  const height = Math.max(8, Math.round(prop.height * placement.scale * spec.heightRatio))
  const offsetX = Math.round(prop.width * placement.scale * (spec.offsetXRatio ?? 0))
  const bottomOffset = Math.round(prop.height * placement.scale * (spec.bottomOffsetRatio ?? 0))
  return {
    name: `propCollider_${String(index).padStart(3, "0")}`,
    x: Math.round(placement.x + offsetX - width / 2),
    y: Math.round(placement.y - bottomOffset - height),
    width,
    height,
  }
}

function arenaOutputPropColliders(props: readonly PropDef[]): Array<Rect & { name: string }> {
  return scaleArenaOutputRects(PLACEMENTS.map((p, i) => scaledColliderForPlacement(props, p, i)))
}

function colorRectLayer(
  props: readonly PropDef[],
  rects: readonly (Rect & { readonly name?: string })[],
  color: { r: number; g: number; b: number; a: number },
): Buffer {
  const data = Buffer.alloc(ARENA_OUTPUT_WIDTH * ARENA_OUTPUT_HEIGHT * 4)
  for (const rect of rects) {
    const x0 = Math.max(0, rect.x)
    const y0 = Math.max(0, rect.y)
    const x1 = Math.min(ARENA_OUTPUT_WIDTH, rect.x + rect.width)
    const y1 = Math.min(ARENA_OUTPUT_HEIGHT, rect.y + rect.height)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const edge = x === x0 || y === y0 || x === x1 - 1 || y === y1 - 1
        const i = (y * ARENA_OUTPUT_WIDTH + x) * 4
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

function maskRegionLayer(
  mask: Mask,
  color: { r: number; g: number; b: number },
  fillAlpha: number,
  lineAlpha: number,
): Buffer {
  const data = Buffer.alloc(ARENA_WIDTH * ARENA_HEIGHT * 4)
  for (let y = 0; y < ARENA_HEIGHT; y++) {
    for (let x = 0; x < ARENA_WIDTH; x++) {
      const i = maskIndex(x, y)
      if (!mask.data[i]) continue
      const edge =
        x === 0 ||
        y === 0 ||
        x === ARENA_WIDTH - 1 ||
        y === ARENA_HEIGHT - 1 ||
        !mask.data[i - 1] ||
        !mask.data[i + 1] ||
        !mask.data[i - ARENA_WIDTH] ||
        !mask.data[i + ARENA_WIDTH]
      const p = i * 4
      data[p] = color.r
      data[p + 1] = color.g
      data[p + 2] = color.b
      data[p + 3] = edge ? lineAlpha : fillAlpha
    }
  }
  return data
}

async function maskLayerPng(
  mask: Mask,
  color: { r: number; g: number; b: number },
  fillAlpha: number,
  lineAlpha: number,
): Promise<Buffer> {
  return sharp(maskRegionLayer(mask, color, fillAlpha, lineAlpha), {
    raw: { width: ARENA_WIDTH, height: ARENA_HEIGHT, channels: 4 },
  })
    .resize(ARENA_OUTPUT_WIDTH, ARENA_OUTPUT_HEIGHT, { kernel: "nearest" })
    .png()
    .toBuffer()
}

function textSvg(width: number, height: number, text: string, options: { fontSize?: number; y?: number } = {}): Buffer {
  const fontSize = options.fontSize ?? 16
  const y = options.y ?? Math.round(height * 0.66)
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#171717"/>
      <text x="${Math.round(width / 2)}" y="${y}" text-anchor="middle"
        font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700"
        fill="#f4f4f5">${escaped}</text>
    </svg>
  `)
}

async function writeGeometryDetailCropSheet(): Promise<void> {
  const sources = [
    { label: "Base", path: BASE_OUT },
    { label: "Walkable", path: resolve(REVIEW_DIR, "walkable-lines.png") },
    { label: "Combined", path: resolve(REVIEW_DIR, "all-overlays-combined.png") },
  ] as const
  const tileWidth = 280
  const tileHeight = 270
  const labelHeight = 28
  const gap = 10
  const headerHeight = 42
  const width = sources.length * tileWidth + (sources.length + 1) * gap
  const height = headerHeight + DETAIL_CROPS.length * (labelHeight + tileHeight + gap) + gap
  const composites: sharp.OverlayOptions[] = [
    { input: textSvg(width, headerHeight, "Walkable geometry detail crops", { fontSize: 20, y: 28 }), left: 0, top: 0 },
  ]

  for (let row = 0; row < DETAIL_CROPS.length; row++) {
    const crop = DETAIL_CROPS[row]!
    for (let col = 0; col < sources.length; col++) {
      const source = sources[col]!
      const tileLeft = gap + col * (tileWidth + gap)
      const tileTop = headerHeight + gap + row * (labelHeight + tileHeight + gap)
      const label = `${crop.label} - ${source.label}`
      composites.push({
        input: textSvg(tileWidth, labelHeight, label, { fontSize: 14, y: 20 }),
        left: tileLeft,
        top: tileTop,
      })
      composites.push({
        input: await sharp(source.path)
          .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
          .png()
          .toBuffer(),
        left: tileLeft + Math.floor((tileWidth - crop.width) / 2),
        top: tileTop + labelHeight,
      })
    }
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 20, g: 20, b: 20, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toFile(resolve(REVIEW_DIR, "walkable-detail-crops.png"))
}

async function writeTopLeftCornerWorkbench(): Promise<void> {
  const crop = TOP_LEFT_CORNER_CROP
  const sources = [
    { label: "Base", path: BASE_OUT },
    { label: "Target Objects", path: SOURCE_TARGET },
    { label: "Walkable", path: resolve(REVIEW_DIR, "walkable-lines.png") },
    { label: "Combined", path: resolve(REVIEW_DIR, "all-overlays-combined.png") },
    { label: "Object Colliders", path: resolve(REVIEW_DIR, "object-collision-yellow-highlight.png") },
  ] as const
  const scale = 2
  const panelWidth = crop.width * scale
  const panelHeight = crop.height * scale
  const labelHeight = 34
  const gap = 12
  const columns = 2
  const rows = Math.ceil(sources.length / columns)
  const width = columns * panelWidth + (columns + 1) * gap
  const height = rows * (labelHeight + panelHeight) + (rows + 1) * gap
  const composites: sharp.OverlayOptions[] = []

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!
    const col = i % columns
    const row = Math.floor(i / columns)
    const left = gap + col * (panelWidth + gap)
    const top = gap + row * (labelHeight + panelHeight + gap)
    composites.push({
      input: textSvg(panelWidth, labelHeight, source.label, { fontSize: 18, y: 23 }),
      left,
      top,
    })
    composites.push({
      input: await sharp(source.path)
        .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
        .resize(panelWidth, panelHeight, { kernel: "nearest" })
        .png()
        .toBuffer(),
      left,
      top: top + labelHeight,
    })
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 16, g: 16, b: 16, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toFile(resolve(REVIEW_DIR, "top-left-corner-workbench.png"))
}

async function writeBottomHalfReviewCrops(): Promise<void> {
  const crop = BOTTOM_HALF_REVIEW_CROP
  const sources = [
    ["walkable-bottom-half-review.png", resolve(REVIEW_DIR, "walkable-lines.png")],
    ["combined-bottom-half-review.png", resolve(REVIEW_DIR, "all-overlays-combined.png")],
  ] as const

  for (const [name, path] of sources) {
    await sharp(path)
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .png()
      .toFile(resolve(REVIEW_DIR, name))
  }
}

async function writeOverlayImages(props: readonly PropDef[]): Promise<void> {
  const propColliders = arenaOutputPropColliders(props)

  const overlays = [
    ["object-collision-yellow-highlight.png", propColliders, { r: 255, g: 230, b: 0, a: 115 }],
  ] as const

  for (const [name, rects, color] of overlays) {
    const overlay = await sharp(colorRectLayer(props, rects, color), {
      raw: { width: ARENA_OUTPUT_WIDTH, height: ARENA_OUTPUT_HEIGHT, channels: 4 },
    }).png().toBuffer()
    const background = name === "object-collision-yellow-highlight.png" ? resolve(REVIEW_DIR, "reconstructed-map.png") : BASE_OUT
    await sharp(background)
      .composite([{ input: overlay, left: 0, top: 0 }])
      .png()
      .toFile(resolve(REVIEW_DIR, name))
  }

  const maskOverlays = [
    ["walkable-lines.png", WALKABLE_MASK, { r: 80, g: 255, b: 120 }, 22, 255],
    ["lava-lines.png", LAVA_MASK, { r: 255, g: 60, b: 0 }, 36, 255],
    ["cliff-lines.png", CLIFF_MASK, { r: 255, g: 255, b: 255 }, 24, 255],
  ] as const
  const rawWalkableMask = Buffer.alloc(ARENA_WIDTH * ARENA_HEIGHT * 4)
  for (let i = 0; i < WALKABLE_MASK.data.length; i++) {
    const value = WALKABLE_MASK.data[i] ? 255 : 0
    const p = i * 4
    rawWalkableMask[p] = value
    rawWalkableMask[p + 1] = value
    rawWalkableMask[p + 2] = value
    rawWalkableMask[p + 3] = 255
  }
  await sharp(rawWalkableMask, { raw: { width: ARENA_WIDTH, height: ARENA_HEIGHT, channels: 4 } })
    .resize(ARENA_OUTPUT_WIDTH, ARENA_OUTPUT_HEIGHT, { kernel: "nearest" })
    .png()
    .toFile(resolve(REVIEW_DIR, "walkable-mask-filled.png"))

  for (const [name, mask, color, fillAlpha, lineAlpha] of maskOverlays) {
    await sharp(BASE_OUT)
      .composite([{ input: await maskLayerPng(mask, color, fillAlpha, lineAlpha), left: 0, top: 0 }])
      .png()
      .toFile(resolve(REVIEW_DIR, name))
  }

  const combined = await sharp(resolve(REVIEW_DIR, "reconstructed-map.png"))
    .composite([
      {
        input: await maskLayerPng(WALKABLE_MASK, { r: 80, g: 255, b: 120 }, 18, 235),
      },
      {
        input: await maskLayerPng(LAVA_MASK, { r: 255, g: 60, b: 0 }, 34, 235),
      },
      {
        input: await maskLayerPng(CLIFF_MASK, { r: 255, g: 255, b: 255 }, 18, 235),
      },
      {
        input: await sharp(colorRectLayer(props, propColliders, { r: 255, g: 230, b: 0, a: 105 }), {
          raw: { width: ARENA_OUTPUT_WIDTH, height: ARENA_OUTPUT_HEIGHT, channels: 4 },
        }).png().toBuffer(),
      },
    ])
    .png()
    .toFile(resolve(REVIEW_DIR, "all-overlays-combined.png"))
  void combined

  await sharp(BASE_OUT)
    .composite([
      {
        input: await sharp(colorRectLayer(props, scaleArenaOutputRects(WALKABLE_RECTS), { r: 80, g: 255, b: 120, a: 12 }), {
          raw: { width: ARENA_OUTPUT_WIDTH, height: ARENA_OUTPUT_HEIGHT, channels: 4 },
        }).png().toBuffer(),
      },
      {
        input: await sharp(colorRectLayer(props, scaleArenaOutputRects(LAVA_RECTS), { r: 255, g: 60, b: 0, a: 18 }), {
          raw: { width: ARENA_OUTPUT_WIDTH, height: ARENA_OUTPUT_HEIGHT, channels: 4 },
        }).png().toBuffer(),
      },
      {
        input: await sharp(colorRectLayer(props, scaleArenaOutputRects(CLIFF_RECTS), { r: 255, g: 255, b: 255, a: 12 }), {
          raw: { width: ARENA_OUTPUT_WIDTH, height: ARENA_OUTPUT_HEIGHT, channels: 4 },
        }).png().toBuffer(),
      },
    ])
    .png()
    .toFile(resolve(REVIEW_DIR, "runtime-rectangles-overlay.png"))

  await sharp(resolve(REVIEW_DIR, "reconstructed-map.png"))
    .composite([{ input: numberedPlacementSvg(), left: 0, top: 0 }])
    .png()
    .toFile(resolve(REVIEW_DIR, "numbered-placement-overlay.png"))

  await writeGeometryDetailCropSheet()
  await writeTopLeftCornerWorkbench()
  await writeBottomHalfReviewCrops()
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

function repoPath(path: string): string {
  return relative(ROOT, path).replace(/\\/g, "/")
}

function writeSceneAndRuntimeSources(props: readonly PropDef[]): void {
  const propById = new Map(props.map((p) => [p.id, p]))
  const placements = arenaOutputPlacements()
  const propColliders = arenaOutputPropColliders(props)
  const lavaRects = scaleArenaOutputRects(LAVA_RECTS)
  const cliffRects = scaleArenaOutputRects(CLIFF_RECTS)
  const nonWalkableRects = scaleArenaOutputRects(NON_WALKABLE_RECTS)
  const walkableRects = scaleArenaOutputRects(WALKABLE_RECTS)

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

  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i]!
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
  for (let i = 0; i < lavaRects.length; i++) {
    const label = `lavaArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, lavaRects[i]!, 0xff3c00))
  }
  for (let i = 0; i < cliffRects.length; i++) {
    const label = `cliffArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, cliffRects[i]!, 0xffffff))
  }
  for (let i = 0; i < nonWalkableRects.length; i++) {
    const rect = nonWalkableRects[i]!
    const label = `nonWalkableArea_${String(i).padStart(3, "0")}`
    displayList.push(rectangleSceneObject(label, label, rect, 0xff0000))
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
          borderWidth: ARENA_OUTPUT_WIDTH,
          borderHeight: ARENA_OUTPUT_HEIGHT,
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

  const propCreateLines = placements.map((placement, index) => {
    const prop = propById.get(placement.propId)!
    const key = `arena-prop-${placement.propId}`
    const varName = `arenaProp${index}`
    return `\n\t\t// ${varName}\n\t\tconst ${varName} = this.add.image(${placement.x}, ${placement.y}, "${key}");\n\t\t${varName}.setOrigin(0.5, 1);\n\t\t${varName}.setScale(${placement.flipX ? -placement.scale : placement.scale}, ${placement.scale});\n\t\t${varName}.setDepth(${placement.y});\n\t\tthis.arenaProps.push(${varName}); // ${prop.label}`
  }).join("\n")

  writeFileSync(
    resolve(ROOT, "src/game/scenes/Arena.ts"),
    `// You can write more code here\n\n/* START OF COMPILED CODE */\n\n/* START-USER-IMPORTS */\nimport Phaser from "phaser"\n\nimport { ARENA_HEIGHT, ARENA_WIDTH } from "@/shared/balance-config/arena"\nimport { TILEMAP_DEPTH } from "@/shared/balance-config/rendering"\nimport type { MinimapCorner } from "@/shared/settings-config"\nimport { WW_LOCAL_PLAYER_ID_REGISTRY_KEY } from "../constants"\nimport { GameConnection } from "../network/GameConnection"\nimport { PlayerRenderSystem } from "../ecs/systems/PlayerRenderSystem"\nimport {\n  publishLoaderComplete,\n  wireSceneLoaderProgress,\n} from "../loaderStatus"\nimport { ArenaRuntime } from "./ArenaRuntime"\n/* END-USER-IMPORTS */\n\nexport default class Arena extends Phaser.Scene {\n\n\tconstructor() {\n\t\tsuper("Arena");\n\n\t\t/* START-USER-CTR-CODE */\n\t\t/* END-USER-CTR-CODE */\n\t}\n\n\teditorCreate(): void {\n\t\t// Arena.scene is a Phaser Editor data scene: it keeps editor-visible\n\t\t// rectangles for regions/colliders, but this runtime output only creates\n\t\t// the visual image layer and props. Region data is exported via arena.json.\n\n\t\t// arena_base\n\t\tconst arenaBase = this.add.image(0, 0, "arena-base");\n\t\tarenaBase.setOrigin(0, 0);\n\t\tarenaBase.setDepth(TILEMAP_DEPTH);\n${propCreateLines}\n\n\t\tthis.arenaWidthPx = ARENA_WIDTH;\n\t\tthis.arenaHeightPx = ARENA_HEIGHT;\n\n\t\tthis.events.emit("scene-awake");\n\t}\n\n\tprivate arenaWidthPx = ARENA_WIDTH;\n\tprivate arenaHeightPx = ARENA_HEIGHT;\n\tprivate arenaProps: Phaser.GameObjects.Image[] = [];\n\n\t/* START-USER-CODE */\n\n\tprivate runtime?: ArenaRuntime\n\n\tpreload(): void {\n\t\tthis.load.pack("arena-assets", "/assets/arena-asset-pack.json")\n\t\twireSceneLoaderProgress(this, {\n\t\t\tscene: "Arena",\n\t\t\tdescription: "Arena assets",\n\t\t})\n\t}\n\n\tcreate(): void {\n\t\tthis.editorCreate()\n\t\tthis.runtime = new ArenaRuntime(this, {\n\t\t\tarenaWidthPx: this.arenaWidthPx,\n\t\t\tarenaHeightPx: this.arenaHeightPx,\n\t\t})\n\t\tthis.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {\n\t\t\tthis.runtime?.destroy()\n\t\t\tthis.runtime = undefined\n\t\t})\n\t\tthis.runtime.start()\n\t\tpublishLoaderComplete(this.game as unknown as Parameters<typeof publishLoaderComplete>[0])\n\t}\n\n\tupdate(time: number, delta: number): void {\n\t\tthis.runtime?.update(time, delta)\n\t}\n\n\t/** Phaser group used to collect all player sprites for iteration. */\n\tget playerGroup(): Phaser.GameObjects.Group {\n\t\treturn this.runtime?.playerGroup as Phaser.GameObjects.Group\n\t}\n\n\t/** Exposed for existing e2e diagnostics. */\n\tget playerRenderSystem(): PlayerRenderSystem | undefined {\n\t\treturn this.runtime?.playerRenderSystem\n\t}\n\n\tgetConnection(): GameConnection {\n\t\treturn this.runtime?.getConnection() as GameConnection\n\t}\n\n\tgetLocalPlayerId(): string | null {\n\t\treturn (\n\t\t\tthis.runtime?.getLocalPlayerId() ??\n\t\t\t((this.game.registry.get(WW_LOCAL_PLAYER_ID_REGISTRY_KEY) as string | undefined) ?? null)\n\t\t)\n\t}\n\n\t/** Applies user-facing audio volume settings to the active runtime. */\n\tsetAudioVolumes(settings: {\n\t\treadonly bgmVolume?: number\n\t\treadonly sfxVolume?: number\n\t}): void {\n\t\tthis.runtime?.setAudioVolumes(settings)\n\t}\n\n\t/** Applies local-only debug overlay mode to the active runtime. */\n\tsetDebugModeEnabled(enabled: boolean): void {\n\t\tthis.runtime?.setDebugModeEnabled(enabled)\n\t}\n\n\t/** Applies persisted minimap placement to the active runtime. */\n\tsetMinimapCorner(corner: MinimapCorner): void {\n\t\tthis.runtime?.setMinimapCorner(corner)\n\t}\n\n\t/* END-USER-CODE */\n}\n\n/* END OF COMPILED CODE */\n\n// You can write more code here\n`,
    "utf8",
  )
}

/**
 * Builds arena asset-pack entries for runtime or Phaser Editor packs.
 *
 * @param props - Arena prop definitions with stable sprite ids.
 * @param absolute - Whether URLs should be absolute web paths.
 * @param includeTilemap - Whether to include the editor tilemap JSON entry.
 * @returns Phaser asset-pack file entries.
 */
export function assetEntries(
  props: readonly { readonly id: string }[],
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
  const placements = arenaOutputPlacements()
  const propColliders = arenaOutputPropColliders(props)
  const metadata = {
    generatedFrom: {
      base: repoPath(SOURCE_BASE),
      objects: repoPath(SOURCE_OBJECTS),
      target: repoPath(SOURCE_TARGET),
      walkableGuide: repoPath(SOURCE_WALKABLE_GUIDE),
    },
    arena: { width: ARENA_OUTPUT_WIDTH, height: ARENA_OUTPUT_HEIGHT },
    props,
    placements,
    propColliders,
    nonWalkableAreas: scaleArenaOutputRects(NON_WALKABLE_RECTS),
    lavaAreas: scaleArenaOutputRects(LAVA_RECTS),
    cliffAreas: scaleArenaOutputRects(CLIFF_RECTS),
    walkableAreas: scaleArenaOutputRects(WALKABLE_RECTS),
    spawnPoints: arenaOutputSpawns(),
  }
  writeFileSync(resolve(PROP_DIR, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
  writeFileSync(resolve(REVIEW_DIR, "placements.json"), `${JSON.stringify({ placements, propColliders }, null, 2)}\n`, "utf8")
}

function writeArenaLayout(): void {
  writeFileSync(
    resolve(ROOT, "src/shared/balance-config/arena-layout.ts"),
    `/**\n * Project-owned native Arena layout data.\n *\n * The arena visual is image-backed at native map resolution. Keep this file in\n * sync with \`Arena.scene\`, \`public/assets/tilemaps/arena.json\`, and the\n * generated collider files when the arena changes.\n */\nexport const ARENA_LAYOUT_WIDTH = ${ARENA_OUTPUT_WIDTH}\nexport const ARENA_LAYOUT_HEIGHT = ${ARENA_OUTPUT_HEIGHT}\nexport const ARENA_LAYOUT_COLS = ${ARENA_OUTPUT_COLS}\nexport const ARENA_LAYOUT_ROWS = ${ARENA_OUTPUT_ROWS}\nexport const ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID = 17\nexport const ARENA_LAYOUT_SPAWN_POINTS = ${JSON.stringify(arenaOutputSpawns(), null, 2)} as const\n`,
    "utf8",
  )
}

async function main(): Promise<void> {
  for (const dir of [PROP_DIR, MAP_DIR, REVIEW_DIR, SOURCE_IMAGE_DIR, MASK_DIR]) {
    mkdirSync(dir, { recursive: true })
  }
  await buildArenaGeometry()
  await sharp(SOURCE_BASE)
    .resize(ARENA_OUTPUT_WIDTH, ARENA_OUTPUT_HEIGHT, { kernel: "nearest" })
    .png()
    .toFile(BASE_OUT)
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

/**
 * Detects direct CLI execution in Bun/tsx without running during test imports.
 *
 * @param argv - Process arguments.
 * @param metaUrl - Current module URL.
 * @returns True when this module is the invoked script.
 */
export function isBuildNativeArenaMapCliEntrypoint(
  argv: readonly string[],
  metaUrl: string,
): boolean {
  const scriptPath = argv[1]
  return Boolean(scriptPath && pathToFileURL(scriptPath).href === metaUrl)
}

/* v8 ignore next 3 */
if (isBuildNativeArenaMapCliEntrypoint(process.argv, import.meta.url)) {
  void main()
}
