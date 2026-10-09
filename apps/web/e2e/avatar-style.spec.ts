import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("account settings avatar style previews differ for jewel, robot, and organic", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `avatar-style-${stamp}@rakazo.test`, "password12", "Avatar style QA");
  await completeOnboarding(page);

  const settings = await openUserSettings(page);
  await expect(settings.getByRole("heading", { name: "Avatars", exact: true })).toBeVisible();

  const robot = settings.getByTestId("avatar-style-robot");
  const organic = settings.getByTestId("avatar-style-organic");
  const jewel = settings.getByTestId("avatar-style-jewel");
  await expect(robot).toBeVisible();
  await expect(organic).toBeVisible();
  await expect(jewel).toBeVisible();
  // New accounts start with the jewel character.
  await expect(jewel).toHaveAttribute("aria-pressed", "true");
  await expect(organic).toHaveAttribute("aria-pressed", "false");
  await expect(robot).toHaveAttribute("aria-pressed", "false");
  await expect(jewel.locator(".rakazo-jewel-avatar")).toBeVisible();
  await expect(robot.locator(".rakazo-jewel-avatar")).toHaveCount(0);
  await expect(robot.locator(".rakazo-bot-avatar")).toBeVisible();
  await expect(organic.locator(".rakazo-organic-avatar")).toBeVisible();
  await expect(robot.locator(".rakazo-organic-avatar")).toHaveCount(0);
  await expect(organic.locator(".rakazo-bot-avatar")).toHaveCount(0);

  const robotMarkup = await robot
    .locator("svg")
    .first()
    .evaluate((el) => el.outerHTML);
  const organicMarkup = await organic
    .locator("svg")
    .first()
    .evaluate((el) => el.outerHTML);
  expect(robotMarkup).not.toBe(organicMarkup);

  await captureScreenshot(page, testInfo, "account-avatars-style-previews");
});
