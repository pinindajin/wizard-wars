import { describe, it, expect } from "vitest"
import { combineDamageProperties, hasDamageProperty, DamageProperty } from "@/shared/balance-config/damage"

describe("combineDamageProperties", () => {
  it("combines single property", () => {
    expect(combineDamageProperties(DamageProperty.Magic)).toBe(DamageProperty.Magic)
  })

  it("combines multiple properties with bitwise OR", () => {
    const combined = combineDamageProperties(DamageProperty.Magic, DamageProperty.Fire)
    expect(combined).toBe(DamageProperty.Magic | DamageProperty.Fire)
  })

  it("combines Physical and Slashing for axe", () => {
    const mask = combineDamageProperties(DamageProperty.Physical, DamageProperty.Slashing)
    expect(hasDamageProperty(mask, DamageProperty.Physical)).toBe(true)
    expect(hasDamageProperty(mask, DamageProperty.Slashing)).toBe(true)
    expect(hasDamageProperty(mask, DamageProperty.Magic)).toBe(false)
  })

  it("combines Magic and Electric for lightning bolt", () => {
    const mask = combineDamageProperties(DamageProperty.Magic, DamageProperty.Electric)
    expect(hasDamageProperty(mask, DamageProperty.Magic)).toBe(true)
    expect(hasDamageProperty(mask, DamageProperty.Electric)).toBe(true)
    expect(hasDamageProperty(mask, DamageProperty.Fire)).toBe(false)
  })

  it("returns 0 with no flags", () => {
    expect(combineDamageProperties()).toBe(0)
  })
})

describe("hasDamageProperty", () => {
  it("returns true when flag is set", () => {
    const mask = DamageProperty.Magic | DamageProperty.Fire
    expect(hasDamageProperty(mask, DamageProperty.Magic)).toBe(true)
    expect(hasDamageProperty(mask, DamageProperty.Fire)).toBe(true)
  })

  it("returns false when flag is not set", () => {
    const mask = DamageProperty.Magic | DamageProperty.Fire
    expect(hasDamageProperty(mask, DamageProperty.Physical)).toBe(false)
    expect(hasDamageProperty(mask, DamageProperty.Slashing)).toBe(false)
    expect(hasDamageProperty(mask, DamageProperty.Electric)).toBe(false)
  })

  it("returns false for mask 0", () => {
    expect(hasDamageProperty(0, DamageProperty.Magic)).toBe(false)
  })
})
