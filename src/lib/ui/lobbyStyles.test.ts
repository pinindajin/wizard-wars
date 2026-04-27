import { describe, expect, it } from "vitest"

import * as styles from "./lobbyStyles"

/**
 * Smoke: ensure exported class tokens are non-empty strings (used across lobby UI).
 */
describe("lobbyStyles exports", () => {
  it("exports string tokens for shell and card primitives", () => {
    expect(typeof styles.pageShell).toBe("string")
    expect(styles.pageShell.length).toBeGreaterThan(10)
    expect(typeof styles.cardPanel).toBe("string")
    expect(typeof styles.sectionTitle).toBe("string")
    expect(typeof styles.lobbyMainGrid).toBe("string")
  })
})
