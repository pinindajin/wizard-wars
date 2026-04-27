import { describe, expect, it } from "vitest"

import {
  CHAT_HISTORY_MAX_MESSAGES,
  CHAT_HISTORY_SHOWN_ON_JOIN,
  CHAT_MAX_MESSAGE_LENGTH,
  CHAT_RATE_LIMIT_COUNT,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from "./constants"

describe("shared constants", () => {
  it("has expected chat limits", () => {
    expect(CHAT_HISTORY_MAX_MESSAGES).toBe(100)
    expect(CHAT_HISTORY_SHOWN_ON_JOIN).toBe(50)
    expect(CHAT_RATE_LIMIT_COUNT).toBe(3)
    expect(CHAT_RATE_LIMIT_WINDOW_MS).toBe(5000)
    expect(CHAT_MAX_MESSAGE_LENGTH).toBe(200)
  })
})
