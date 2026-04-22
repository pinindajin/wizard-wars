import { describe, expect, it } from "vitest"

import { parseWsAuthSessionPayload } from "./parse-ws-auth-session"

describe("parseWsAuthSessionPayload", () => {
  it("returns null for non-object input", () => {
    expect(parseWsAuthSessionPayload(undefined)).toBeNull()
    expect(parseWsAuthSessionPayload(null)).toBeNull()
    expect(parseWsAuthSessionPayload("x")).toBeNull()
    expect(parseWsAuthSessionPayload(1)).toBeNull()
    expect(parseWsAuthSessionPayload(true)).toBeNull()
  })

  it("returns null when token is missing, wrong type, or empty", () => {
    expect(
      parseWsAuthSessionPayload({ sub: "u1", username: "a" }),
    ).toBeNull()
    expect(
      parseWsAuthSessionPayload({ token: 1, sub: "u1", username: "a" }),
    ).toBeNull()
    expect(
      parseWsAuthSessionPayload({ token: "", sub: "u1", username: "a" }),
    ).toBeNull()
  })

  it("returns null when sub is missing, wrong type, or empty", () => {
    expect(
      parseWsAuthSessionPayload({ token: "t", username: "a" }),
    ).toBeNull()
    expect(
      parseWsAuthSessionPayload({ token: "t", sub: 1, username: "a" }),
    ).toBeNull()
    expect(
      parseWsAuthSessionPayload({ token: "t", sub: "", username: "a" }),
    ).toBeNull()
  })

  it("returns null when username is missing, wrong type, or empty", () => {
    expect(parseWsAuthSessionPayload({ token: "t", sub: "u1" })).toBeNull()
    expect(
      parseWsAuthSessionPayload({ token: "t", sub: "u1", username: null }),
    ).toBeNull()
    expect(
      parseWsAuthSessionPayload({ token: "t", sub: "u1", username: 99 }),
    ).toBeNull()
    expect(
      parseWsAuthSessionPayload({ token: "t", sub: "u1", username: "" }),
    ).toBeNull()
  })

  it("returns session when all fields are non-empty strings", () => {
    expect(
      parseWsAuthSessionPayload({
        token: "jwt-here",
        sub: "user-123",
        username: "alice",
      }),
    ).toEqual({
      token: "jwt-here",
      sub: "user-123",
      username: "alice",
    })
  })
})
