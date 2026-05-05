import { describe, expect, it } from "vitest"

import {
  buildArenaPackAudioUrlByKey,
  resolveArenaPackAudioSiteUrlForSfxKey,
  siteAssetUrlToPublicDiskPathLabel,
} from "./arenaPackAudioUrls"

describe("arenaPackAudioUrls", () => {
  it("maps known SFX keys to the same URLs as the committed arena pack", () => {
    expect(resolveArenaPackAudioSiteUrlForSfxKey("sfx-axe-swing")).toBe("/assets/sounds/sfx-axe-swing.wav")
    expect(resolveArenaPackAudioSiteUrlForSfxKey("sfx-jump")).toBe("/assets/sounds/dirt-jump.wav")
    expect(resolveArenaPackAudioSiteUrlForSfxKey("sfx-fireball-cast")).toBe("/assets/sounds/sfx-fireball-cast.mp3")
    expect(resolveArenaPackAudioSiteUrlForSfxKey("sfx-walk-step")).toBe("/assets/sounds/dirt-walk-2.wav")
  })

  it("returns null for unknown keys", () => {
    expect(resolveArenaPackAudioSiteUrlForSfxKey("not-a-real-sfx-key")).toBeNull()
  })

  it("buildArenaPackAudioUrlByKey prefers first audio url per key", () => {
    const map = buildArenaPackAudioUrlByKey({
      arena: {
        files: [
          { type: "audio", key: "a", url: ["/first.mp3", "/second.mp3"] },
          { type: "audio", key: "a", url: "/ignored.mp3" },
        ],
      },
    })
    expect(map.get("a")).toBe("/first.mp3")
  })

  it("siteAssetUrlToPublicDiskPathLabel maps site paths to public/ labels", () => {
    expect(siteAssetUrlToPublicDiskPathLabel("/assets/sounds/x.wav")).toBe("public/assets/sounds/x.wav")
  })
})
