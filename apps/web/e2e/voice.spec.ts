import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, rpc, signup } from "./helpers";

test("voice settings connect a key, speak a reply, and open a call", async ({ page }, testInfo) => {
  const stamp = Date.now();
  const userName = `Voice ${stamp}`;
  await signup(page, `voice-${stamp}@rakazo.test`, "password12", userName);
  await completeOnboarding(page);

  await expect(page.getByRole("button", { name: "Call", exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Live talk", exact: true }),
  ).toHaveCount(1);
  // The mic is a separate dictation control; Live talk opens settings until voice is set up.
  await expect(
    page.getByTestId("composer-bar").getByRole("button", { name: "Dictate", exact: true }),
  ).toHaveCount(1);
  await captureScreenshot(page, testInfo, "voice-composer");
  await page
    .getByTestId("composer-bar")
    .getByRole("button", { name: "Live talk", exact: true })
    .click();
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-settings");
  await page.getByRole("button", { name: "Close voice settings" }).click();
  await expect(page.getByTestId("voice-settings")).toHaveCount(0);

  const preparedOff = await rpc<{ ready: boolean }>(page, "voice/prepare", {
    text: "Hello there.",
  });
  expect(preparedOff.ready).toBe(false);

  await openUserSettings(page, "voice");
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await page.getByRole("button", { name: /Scripted/ }).click();
  const apiKeyInput = page.getByPlaceholder(/Paste your API key/);
  await expect(apiKeyInput).toHaveAttribute("autocomplete", "new-password");
  await apiKeyInput.fill("fake-scripted-voice-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-settings-connected");

  const spoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await page.getByRole("button", { name: "Hear a sample" }).click();
  const clip = await spoken;
  expect(clip.headers()["content-type"]).toContain("audio/mpeg");

  const credentials = await rpc<Array<{ hasKey: boolean; provider: string }>>(
    page,
    "voice/credentials",
    {},
  );
  expect(credentials).toEqual([expect.objectContaining({ hasKey: true, provider: "scripted" })]);
  expect(JSON.stringify(credentials)).not.toContain("fake-scripted-voice-key");

  await page.getByRole("button", { name: "Close voice settings" }).click();

  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("say hello");
  await page.keyboard.press("Enter");
  // Speak is a small icon beside the bubble; hover the latest reply to reveal it on desktop.
  const lastReply = page.getByTestId("message-bot-bubble").last();
  await expect(lastReply).toBeVisible({ timeout: 30_000 });
  await lastReply.hover();
  const speakReply = page.getByRole("button", { name: "Speak this reply" }).last();
  await expect(speakReply).toBeVisible();

  const replySpoken = page.waitForResponse(
    (response) => response.url().includes("/api/voice/speak") && response.ok(),
  );
  await speakReply.click();
  await replySpoken;

  await openUserSettings(page, "voice");
  await expect(page.getByRole("button", { name: "Replace key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close voice settings" }).click();

  await page
    .getByTestId("composer-bar")
    .getByRole("button", { name: "Live talk", exact: true })
    .click();
  await expect(page.getByTestId("call-view")).toBeVisible();
  await expect(page.getByTestId("composer-bar")).toBeVisible();
  await expect(page.getByTestId("transcript")).toBeVisible();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  // The call bar must never hide the newest reply.
  const newestReply = page.getByTestId("message-bot-bubble").last();
  await expect(newestReply).toBeInViewport({ ratio: 1 });
  await captureScreenshot(page, testInfo, "voice-inline-live");
  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("call-view")).toBeInViewport();
  await expect(newestReply).toBeInViewport({ ratio: 1 });
  await captureScreenshot(page, testInfo, "voice-inline-live-mobile");
  if (desktopViewport) await page.setViewportSize(desktopViewport);
  await expect(page.getByRole("button", { name: "Hang up" })).toBeVisible();
  await page.getByRole("button", { name: "Hang up" }).click();
  await expect(page.getByTestId("call-view")).toHaveCount(0);

  await openUserSettings(page, "voice");
  const settings = page.getByTestId("voice-settings");
  await settings.getByPlaceholder(/Paste a replacement key/).fill("leftover-voice-key");
  await settings.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Disconnect", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await expect(settings.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(rpc<Array<{ provider: string }>>(page, "voice/credentials", {})).resolves.toEqual(
    [],
  );
});
