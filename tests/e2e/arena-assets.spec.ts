import { test, expect, type APIRequestContext } from "@playwright/test"

/** Narrow shape for asset-pack file entries; enough for URL walking. */
type PackFile = {
  readonly type: string
  readonly key: string
  readonly url: string | readonly string[]
}

type AssetPack =
  | { readonly boot: { readonly files: readonly PackFile[] } }
  | { readonly preload: { readonly files: readonly PackFile[] } }
  | { readonly arena: { readonly files: readonly PackFile[] } }

/**
 * Flattens a pack's URLs (single or array) into a flat list.
 *
 * @param files - Pack file entries.
 * @returns Array of URL strings.
 */
function packUrls(files: readonly PackFile[]): string[] {
  const out: string[] = []
  for (const f of files) {
    if (typeof f.url === "string") out.push(f.url)
    else for (const u of f.url) out.push(u)
  }
  return out
}

/**
 * Fetches an asset pack JSON and returns its file URLs.
 *
 * @param request - Playwright request context.
 * @param path - Absolute pack path (e.g. `/assets/arena-asset-pack.json`).
 * @param rootKey - Top-level key in the JSON (`boot`, `preload`, `arena`).
 * @returns Array of URLs declared in the pack.
 */
async function loadPack(
  request: APIRequestContext,
  path: string,
  rootKey: "boot" | "preload" | "arena",
): Promise<string[]> {
  const res = await request.get(path)
  expect(res.status(), `${path} should return 200`).toBe(200)
  const json = (await res.json()) as AssetPack
  const files = (json as Record<string, { files: readonly PackFile[] }>)[rootKey]
    ?.files
  expect(files, `${path} missing files`).toBeDefined()
  return packUrls(files as readonly PackFile[])
}

test("arena static asset pack is served", async ({ request }) => {
  const res = await request.get("/assets/arena-asset-pack.json")
  expect(res.status()).toBe(200)
  const json = (await res.json()) as { arena?: { files?: unknown[] } }
  expect(json.arena?.files?.length).toBeGreaterThan(0)
})

test("lady-wizard megasheet is served", async ({ request }) => {
  const res = await request.get(
    "/assets/sprites/heroes/lady-wizard/sheets/lady-wizard-megasheet.png",
  )
  expect(res.status()).toBe(200)
  expect(res.headers()["content-type"] ?? "").toMatch(/image\/png/)
})

test("every URL in every asset pack resolves with a 200", async ({ request }) => {
  const urls = [
    ...(await loadPack(request, "/assets/boot-asset-pack.json", "boot")),
    ...(await loadPack(request, "/assets/preload-asset-pack.json", "preload")),
    ...(await loadPack(request, "/assets/arena-asset-pack.json", "arena")),
  ]

  // Sanity: every url is absolute root-relative.
  for (const u of urls) {
    expect(u.startsWith("/"), `pack url is not absolute: ${u}`).toBe(true)
  }

  const failed: Array<{ url: string; status: number }> = []
  for (const url of urls) {
    const res = await request.get(url)
    const status = res.status()
    if (status !== 200) failed.push({ url, status })
  }
  expect(
    failed,
    `expected every asset to 200, got failures: ${JSON.stringify(failed)}`,
  ).toEqual([])
})

test("countdown SFX are served from /assets/sounds/", async ({ request }) => {
  for (const name of ["sfx-countdown-beep.mp3", "sfx-countdown-go.mp3"]) {
    const res = await request.get(`/assets/sounds/${name}`)
    expect(res.status(), `${name} should be served from /assets/sounds/`).toBe(200)
  }
})
