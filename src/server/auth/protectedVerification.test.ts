import { describe, expect, it } from "vitest"

import { shouldVerifyUserOnProtected } from "./protectedVerification"
import {
  buildSessionExpiredLoginPath,
  buildSessionExpiredPath,
  sanitizeRelativeNext,
} from "./sessionRedirect"

describe("protected verification helpers", () => {
  it("parses VERIFY_USER_ON_PROTECTED as false by default", () => {
    expect(shouldVerifyUserOnProtected(undefined)).toBe(false)
    expect(shouldVerifyUserOnProtected("")).toBe(false)
    expect(shouldVerifyUserOnProtected("false")).toBe(false)
  })

  it("accepts documented and legacy truthy values", () => {
    expect(shouldVerifyUserOnProtected("true")).toBe(true)
    expect(shouldVerifyUserOnProtected("1")).toBe(true)
  })

  it("sanitizes login next paths", () => {
    expect(sanitizeRelativeNext("/browse?tab=open")).toBe("/browse?tab=open")
    expect(sanitizeRelativeNext("//evil.example")).toBe("/home")
    expect(sanitizeRelativeNext("https://evil.example/home")).toBe("/home")
    expect(sanitizeRelativeNext("")).toBe("/home")
  })

  it("builds session-expired redirect paths", () => {
    expect(buildSessionExpiredPath("/lobby/r1?x=1")).toBe(
      "/api/auth/session-expired?next=%2Flobby%2Fr1%3Fx%3D1",
    )
    expect(buildSessionExpiredLoginPath("/lobby/r1")).toBe(
      "/login?next=%2Flobby%2Fr1&reason=session-expired",
    )
  })
})
