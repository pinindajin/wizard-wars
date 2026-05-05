import { describe, expect, it } from "vitest"

import {
  clampPreviewVolumePercent,
  parseStoredPreviewVolumePercent,
  previewVolumePercentToAudioVolume,
} from "./animationToolPreviewVolume"

describe("animationToolPreviewVolume", () => {
  it("clamps to 0–100", () => {
    expect(clampPreviewVolumePercent(-5)).toBe(0)
    expect(clampPreviewVolumePercent(150)).toBe(100)
    expect(clampPreviewVolumePercent(42.4)).toBe(42)
  })

  it("maps percent to audio volume", () => {
    expect(previewVolumePercentToAudioVolume(0)).toBe(0)
    expect(previewVolumePercentToAudioVolume(100)).toBe(1)
    expect(previewVolumePercentToAudioVolume(50)).toBe(0.5)
  })

  it("parses storage", () => {
    expect(parseStoredPreviewVolumePercent(null)).toBe(85)
    expect(parseStoredPreviewVolumePercent("")).toBe(85)
    expect(parseStoredPreviewVolumePercent("40")).toBe(40)
    expect(parseStoredPreviewVolumePercent("NaN")).toBe(85)
  })
})
