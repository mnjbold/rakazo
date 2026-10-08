import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("starts a new chat, reopens the old one, and keeps its context", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `chat-sessions-${stamp}@rakazo.test`, "password12", "Sessions Tester");
  await completeOnboarding(page);

  const transcript = page.getByTestId("transcript");
  const composer = page.getByRole("combobox", { name: /Message/ });
  const keyword = `lisbon-trip-${stamp}`;

  await composer.fill(`plan the ${keyword}`);
  await composer.press("Enter");
  await expect(transcript.getByText(`plan the ${keyword}`, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  // New chat appears once the reply's run has finished.
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible({ timeout: 60_000 });
  // Nothing archived yet, so there is no history to open.
  await expect(page.getByRole("button", { name: "Chat history" })).toHaveCount(0);

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(transcript.getByText(`plan the ${keyword}`, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New chat" })).toHaveCount(0);

  await page.getByRole("button", { name: "Chat history" }).click();
  const pastChat = page.getByRole("button", { name: new RegExp(keyword) });
  await expect(pastChat).toBeVisible();
  await captureScreenshot(page, testInfo, "chat-history-menu");
  await pastChat.click();

  const view = page.getByTestId("chat-session-view");
  await expect(view.getByTestId("chat-session-transcript")).toContainText(`plan the ${keyword}`);
  await captureScreenshot(page, testInfo, "chat-session-view");
  await view.getByRole("button", { name: "Close" }).click();
  await expect(view).toHaveCount(0);

  // The run in the new chat receives the archived chat as context.
  await composer.fill("what did we discuss in earlier chats");
  await composer.press("Enter");
  await expect(transcript.getByText(/earlier chats:/)).toContainText(keyword, { timeout: 60_000 });
});
