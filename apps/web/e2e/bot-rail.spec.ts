import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, createNamedBot, signup } from "./helpers";

async function signupWithTwoBots(page: Page, label: string) {
  await signup(page, `bot-rail-${label}-${Date.now()}@rakazo.test`, "password12", "Rail Test");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  const chiefId = page.url().split("/").pop()!;
  const scoutId = await createNamedBot(page, "Scout");
  return { chiefId, scoutId };
}

test("the rail switches bots and stays usable with the sidebar collapsed", async ({
  page,
}, testInfo) => {
  const { chiefId, scoutId } = await signupWithTwoBots(page, "desktop");
  const rail = page.getByTestId("app-rail-bots");
  await expect(rail.locator("[data-rail-bot-id]")).toHaveCount(2);
  await expect(rail.getByRole("button", { name: "Scout" })).toHaveAttribute("aria-current", "page");

  await rail.getByRole("button", { name: "Chief" }).click();
  await page.waitForURL(`**/app/${chiefId}`);
  await expect(rail.getByRole("button", { name: "Chief" })).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("button", { name: "Scout" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByTestId("minimize-bots-sidebar").click();
  await expect(page.getByTestId("bots-sidebar")).toHaveAttribute("data-collapsed", "true");
  await rail.getByRole("button", { name: "Scout" }).click();
  await page.waitForURL(`**/app/${scoutId}`);
  await expect(page.getByPlaceholder("Message Scout")).toBeVisible();
  await captureScreenshot(page, testInfo, "bot-rail-desktop-collapsed");

  await page.reload();
  await expect(page.getByTestId("bots-sidebar")).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("app-rail-bots").locator("[data-rail-bot-id]")).toHaveCount(2);
});

test.describe("mobile", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("the rail fits a phone without horizontal scroll", async ({ page }, testInfo) => {
    const { chiefId } = await signupWithTwoBots(page, "mobile");
    const rail = page.getByTestId("app-rail-bots");
    const chief = rail.getByRole("button", { name: "Chief" });
    const box = await chief.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(40);
    expect(box?.height).toBeGreaterThanOrEqual(40);

    await chief.tap();
    await page.waitForURL(`**/app/${chiefId}`);
    await expect(page.getByPlaceholder("Message Chief")).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await captureScreenshot(page, testInfo, "bot-rail-mobile");
  });
});
