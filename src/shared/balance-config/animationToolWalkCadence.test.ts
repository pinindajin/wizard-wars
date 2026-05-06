import { describe, expect, it } from "vitest"

import { walkFootstepCadenceMarkerTimesMs } from "./animationToolWalkCadence"

describe("walkFootstepCadenceMarkerTimesMs", () => {
  it("returns two markers spaced at half the walk loop", () => {
    expect(walkFootstepCadenceMarkerTimesMs(600)).toEqual([0, 300])
  })

  it("returns empty for non-positive duration", () => {
    expect(walkFootstepCadenceMarkerTimesMs(0)).toEqual([])
    expect(walkFootstepCadenceMarkerTimesMs(-1)).toEqual([])
  })
})
