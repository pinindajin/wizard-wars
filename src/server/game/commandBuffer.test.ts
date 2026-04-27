import { describe, expect, it } from "vitest"
import { addEntity, createWorld, hasComponent } from "bitecs"

import { createCommandBuffer } from "./commandBuffer"

describe("createCommandBuffer", () => {
  it("executes addEntity and removeEntity", () => {
    const world = createWorld()
    const buf = createCommandBuffer()
    let created = -1
    buf.enqueue({
      type: "addEntity",
      setup: (eid) => {
        created = eid
      },
    })
    buf.execute(world)
    expect(created).toBeGreaterThanOrEqual(0)
    buf.enqueue({ type: "removeEntity", eid: created })
    buf.execute(world)
  })

  it("executes addComponent and removeComponent", () => {
    const world = createWorld()
    const Comp = { x: [] as number[] }
    const eid = addEntity(world)
    const buf = createCommandBuffer()
    buf.enqueue({ type: "addComponent", eid, component: Comp })
    buf.execute(world)
    expect(hasComponent(world, eid, Comp)).toBe(true)
    buf.enqueue({ type: "removeComponent", eid, component: Comp })
    buf.execute(world)
    expect(hasComponent(world, eid, Comp)).toBe(false)
  })

  it("clear drops queued commands", () => {
    const world = createWorld()
    const buf = createCommandBuffer()
    buf.enqueue({ type: "addEntity", setup: () => {} })
    buf.clear()
    buf.execute(world)
  })
})
