import { describe, expect, it } from "vitest"

import { isUnauthorizedTrpcError } from "./trpcErrors"

describe("isUnauthorizedTrpcError", () => {
  it("returns false for non-objects and null", () => {
    expect(isUnauthorizedTrpcError(undefined)).toBe(false)
    expect(isUnauthorizedTrpcError(null)).toBe(false)
    expect(isUnauthorizedTrpcError("err")).toBe(false)
    expect(isUnauthorizedTrpcError(42)).toBe(false)
  })

  it("detects UNAUTHORIZED on data.code", () => {
    expect(isUnauthorizedTrpcError({ data: { code: "UNAUTHORIZED" } })).toBe(true)
  })

  it("detects UNAUTHORIZED on shape.data.code", () => {
    expect(
      isUnauthorizedTrpcError({ shape: { data: { code: "UNAUTHORIZED" } } }),
    ).toBe(true)
  })

  it("returns false when neither path carries UNAUTHORIZED", () => {
    expect(isUnauthorizedTrpcError({ data: { code: "BAD_REQUEST" } })).toBe(false)
    expect(isUnauthorizedTrpcError({ shape: { data: { code: "FORBIDDEN" } } })).toBe(
      false,
    )
    expect(isUnauthorizedTrpcError({})).toBe(false)
  })

  it("falls through to shape.data when data.code is not UNAUTHORIZED", () => {
    expect(
      isUnauthorizedTrpcError({
        data: { code: "BAD_REQUEST" },
        shape: { data: { code: "UNAUTHORIZED" } },
      }),
    ).toBe(true)
  })
})
