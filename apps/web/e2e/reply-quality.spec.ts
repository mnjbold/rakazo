import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("a thumbs down on a bot reply shows up as reply quality in bot settings", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `reply-quality-${stamp}@rakazo.test`, "password12", "Reply Quality");
  await completeOnboarding(page);

  // Onboarding greetings are not run replies; feedback needs a reply from a real run.
  const composer = page.getByRole("combobox", { name: /^Message/ });
  await composer.fill(`summarize my week ${stamp}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const botText = page.getByTestId("message-bot-bubble").getByText(/^on it\./);
  await expect(page.getByTestId("transcript").getByText(/^on it\./)).toBeVisible({
    timeout: 30_000,
  });
  const botRow = page
    .getByTestId("transcript")
    .locator("[data-message-id]")
    .filter({ has: botText })
    .first();
  await botRow.hover();
  await botRow.getByRole("button", { name: "React" }).click();
  await page.getByRole("button", { name: "👎", exact: true }).click();
  await expect(botRow.getByTestId("message-reactions")).toContainText("👎");

  await page.locator("main").getByRole("button", { name: "Chief", exact: true }).click();
  const quality = page.getByTestId("bot-settings").getByTestId("bot-reply-quality");
  await expect(quality).toBeVisible();
  await expect(quality).toContainText("Reply quality");
  await expect(quality).toContainText("Needs work");
  await expect(quality).toContainText("Recent replies got a thumbs down");
  await quality.scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, "bot-settings-reply-quality");
});
