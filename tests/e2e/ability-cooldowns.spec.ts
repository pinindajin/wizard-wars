import { test } from "@playwright/test"

import {
  assertJumpRechargeVisible,
  buyAndAssignJump,
  castFireballAndAssertCooldown,
  depleteJumpCharges,
  startSinglePlayerMatch,
} from "./ability-cooldown-helpers"

test("ability HUD shows cooldown countdowns and jump charges", async ({ page }) => {
  test.slow()
  test.setTimeout(180_000)

  await startSinglePlayerMatch(page)
  await castFireballAndAssertCooldown(page)
  await buyAndAssignJump(page)
  await depleteJumpCharges(page)
  await assertJumpRechargeVisible(page)
})
