import superjson from "superjson"
import { describe, expect, it } from "vitest"

import { getTrpcMutationErrorMessage } from "./trpcMutationErrorMessage"

describe("getTrpcMutationErrorMessage", () => {
  it("returns null for non-object payload", () => {
    expect(getTrpcMutationErrorMessage(null)).toBeNull()
    expect(getTrpcMutationErrorMessage("x")).toBeNull()
  })

  it("returns null when error missing", () => {
    expect(getTrpcMutationErrorMessage({})).toBeNull()
    expect(getTrpcMutationErrorMessage({ error: null })).toBeNull()
  })

  it("reads plain error.message", () => {
    expect(getTrpcMutationErrorMessage({ error: { message: "oops" } })).toBe("oops")
  })

  it("reads zod field errors from deserialized json", () => {
    const inner = {
      message: "Validation failed",
      data: {
        zodError: {
          fieldErrors: { username: ["Too short"] },
          formErrors: [],
        },
      },
    }
    const encoded = superjson.serialize(inner)
    const payload = { error: { json: encoded } }
    expect(getTrpcMutationErrorMessage(payload)).toBe("Too short")
  })

  it("returns typedData.message when no zod errors", () => {
    const payload = { error: { json: { message: "Server error", data: {} } } }
    expect(getTrpcMutationErrorMessage(payload)).toBe("Server error")
  })
})
