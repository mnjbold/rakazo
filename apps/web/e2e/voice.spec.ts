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

  const transcript = page.getByTestId("transcript");
  const transcriptBefore = await transcript.boundingBox();
  await page
    .getByTestId("composer-bar")
    .getByRole("button", { name: "Live talk", exact: true })
    .click();
  const callView = page.getByTestId("call-view");
  await expect(callView).toBeVisible();
  await expect(page.getByTestId("composer-bar")).toBeVisible();
  await expect(transcript).toBeVisible();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  // The bar floats over the transcript: the transcript keeps its size and stays scrollable.
  expect(await transcript.boundingBox()).toEqual(transcriptBefore);
  expect(await transcript.evaluate((el) => getComputedStyle(el).overflowY)).toMatch(/auto|scroll/);
  const callBox = await callView.boundingBox();
  expect(callBox?.width).toBeLessThanOrEqual(420);
  expect(callBox?.height).toBeLessThan(120);
  // The call bar must never hide the newest reply.
  const newestReply = page.getByTestId("message-bot-bubble").last();
  await expect(newestReply).toBeInViewport({ ratio: 1 });
  const replyUncovered = () =>
    newestReply.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && el.contains(hit));
    });
  expect(await replyUncovered()).toBe(true);
  const mute = callView.getByRole("button", { name: "Mute", exact: true });
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await captureScreenshot(page, testInfo, "voice-inline-live-muted");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  // Typing stays available while on a call.
  const draft = page.getByTestId("composer-bar").getByRole("combobox", { name: /Message/ });
  await draft.fill("typing during a call");
  await expect(draft).toHaveValue("typing during a call");
  await draft.fill("");
  await callView.getByRole("button", { name: "Voice settings", exact: true }).click();
  await expect(page.getByTestId("voice-settings")).toBeVisible();
  await page.getByRole("button", { name: "Close voice settings" }).click();
  await expect(page.getByTestId("voice-settings")).toHaveCount(0);
  await expect(callView).toBeVisible();
  await captureScreenshot(page, testInfo, "voice-inline-live");
  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(callView).toBeInViewport();
  await expect(newestReply).toBeInViewport({ ratio: 1 });
  expect(await replyUncovered()).toBe(true);
  // Phone: the chat column's width minus 12px gutters.
  const phoneBox = await callView.boundingBox();
  const column = await transcript.boundingBox();
  expect(phoneBox?.x).toBeCloseTo((column?.x ?? 0) + 12, 0);
  expect(phoneBox?.width).toBeCloseTo((column?.width ?? 0) - 24, 0);
  await captureScreenshot(page, testInfo, "voice-inline-live-mobile");
  if (desktopViewport) await page.setViewportSize(desktopViewport);
  await callView.getByRole("button", { name: "Hang up" }).click();
  await expect(callView).toHaveCount(0);

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
