import arenaAssetPackJson from "../../../public/assets/arena-asset-pack.json"

type ArenaPackFileEntry = {
  readonly type?: string
  readonly key?: string
  readonly url?: string | readonly string[]
}

type ArenaPackJson = {
  readonly arena?: {
    readonly files?: readonly ArenaPackFileEntry[]
  }
}

/**
 * Returns the first URL string from a Phaser pack `url` field (string or array).
 *
 * @param entry - Pack file entry.
 * @returns Site-root-relative path beginning with `/`, or `null`.
 */
function firstPackAudioUrl(entry: ArenaPackFileEntry): string | null {
  const u = entry.url
  if (typeof u === "string" && u.length > 0) return u
  if (Array.isArray(u) && u.length > 0 && typeof u[0] === "string" && u[0].length > 0) return u[0]
  return null
}

/**
 * Builds a map of Phaser audio cache key → first registered URL from the arena asset pack.
 *
 * @param pack - Parsed arena pack JSON (shape matches `public/assets/arena-asset-pack.json`).
 * @returns Immutable map of SFX key to site URL (e.g. `/assets/sounds/foo.wav`).
 */
export function buildArenaPackAudioUrlByKey(
  pack: ArenaPackJson,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  const files = pack.arena?.files
  if (!files) return map
  for (const f of files) {
    if (f.type !== "audio" || typeof f.key !== "string") continue
    const url = firstPackAudioUrl(f)
    if (url == null) continue
    if (!map.has(f.key)) map.set(f.key, url)
  }
  return map
}

const ARENA_PACK_AUDIO_URL_BY_KEY: ReadonlyMap<string, string> = buildArenaPackAudioUrlByKey(
  arenaAssetPackJson as ArenaPackJson,
)

/**
 * Resolves the committed arena pack URL for a Phaser SFX cache key (animation tool + parity checks).
 *
 * @param sfxKey - Phaser audio key (e.g. `sfx-jump`).
 * @returns Site-relative URL such as `/assets/sounds/dirt-jump.wav`, or `null` if missing or not audio.
 */
export function resolveArenaPackAudioSiteUrlForSfxKey(sfxKey: string): string | null {
  return ARENA_PACK_AUDIO_URL_BY_KEY.get(sfxKey) ?? null
}

/**
 * Converts a site URL (`/assets/...`) to a repo-relative `public/...` label for dev tooling copy.
 *
 * @param siteUrl - Path beginning with `/` as loaded by the browser from `public/`.
 * @returns e.g. `public/assets/sounds/foo.wav`.
 */
export function siteAssetUrlToPublicDiskPathLabel(siteUrl: string): string {
  if (siteUrl.startsWith("/")) return `public${siteUrl}`
  return `public/${siteUrl}`
}
