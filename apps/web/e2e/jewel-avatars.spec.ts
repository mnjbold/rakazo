import { expect, test } from "@playwright/test";
import { BOT_MOODS } from "@rakazo/core";
import { captureScreenshot } from "./helpers";

test("jewel characters render every mood and a needs-you sidebar", async ({ page }, testInfo) => {
  await page.goto("/e2e/fixtures/jewel-avatars.html");

  for (const mood of BOT_MOODS) {
    const cell = page.getByTestId(`jewel-${mood}`);
    await expect(cell.locator(".rakazo-jewel-avatar").first()).toHaveAttribute("data-mood", mood);
  }
  await expect(page.locator('[data-mood="error"] .rakazo-jewel-badge').first()).toBeVisible();
  await expect(page.locator('[data-mood="needs_you"] .rakazo-jewel-pulse').first()).toBeVisible();

  const sidebar = page.getByTestId("jewel-sidebar");
  await expect(sidebar.locator(".rakazo-jewel-avatar")).toHaveCount(50);
  const needsYou = sidebar.locator('[data-roster-bot-id="bot-1"]');
  await expect(needsYou).toHaveAccessibleName(/^Grace 1 ?, needs you$/);
  await expect(needsYou.locator(".rakazo-jewel-avatar")).toHaveAttribute("data-mood", "needs_you");
  await expect(
    sidebar.locator('[data-roster-bot-id="bot-2"] .rakazo-jewel-avatar'),
  ).toHaveAttribute("data-mood", "working");

  // Petting reacts without changing the mood.
  const header = page.getByTestId("jewel-idle").locator(".rakazo-jewel-avatar").first();
  await header.hover();
  await page.mouse.down();
  await expect(header).toHaveAttribute("data-pet", "wobble");
  await page.mouse.up();
  await expect(header).toHaveAttribute("data-mood", "idle");
  await expect(header).not.toHaveAttribute("data-pet", "wobble");

  await captureScreenshot(page, testInfo, "jewel-avatars-moods");
});

test("jewel characters hold still with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/jewel-avatars.html");
  const animations = await page
    .getByTestId("jewel-moods")
    .evaluate(
      (root) =>
        [...root.querySelectorAll(".rakazo-jewel-avatar *")].filter(
          (element) => getComputedStyle(element).animationName !== "none",
        ).length,
    );
  expect(animations).toBe(0);
});
