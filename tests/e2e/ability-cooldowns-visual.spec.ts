import { test } from "@playwright/test"

import {
  buyAndAssignJump,
  castFireballAndAssertCooldown,
  depleteJumpCharges,
  startSinglePlayerMatch,
} from "./ability-cooldown-helpers"

test("ability cooldown HUD visual capture (env-gated)", async ({ page }) => {
  test.skip(
    process.env.WW_ABILITY_COOLDOWN_VISUAL !== "1",
    "Set WW_ABILITY_COOLDOWN_VISUAL=1 to capture the ability cooldown HUD screenshot.",
  )
  test.slow()
  test.setTimeout(180_000)

  await startSinglePlayerMatch(page)
  const fireball = await castFireballAndAssertCooldown(page)
  await buyAndAssignJump(page)
  const jump = await depleteJumpCharges(page)

  console.log(
    `WW ability cooldown HUD evidence: fireball=${JSON.stringify(fireball)} jump=${JSON.stringify(jump)}`,
  )
  await page.screenshot({
    path: "test-results/ability-cooldowns-hud.png",
    fullPage: true,
  })
})
