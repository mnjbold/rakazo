import { expect, test } from "@playwright/test";
import type { Bot, Routine } from "@rakazo/contracts";
import { captureScreenshot, completeOnboarding, openNewBot, rpc, signup } from "./helpers";

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("an image drafts the create form; the person confirms before anything is created", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `bot-image-${stamp}@rakazo.test`, "password12", "Bot Image");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  await openNewBot(page);

  const form = page.getByTestId("create-bot-form");
  const drafted = page.waitForResponse((response) =>
    response.url().includes("/rpc/bots/draftFromImage"),
  );
  await form
    .getByTestId("create-bot-image-input")
    .setInputFiles({ name: "harbor.png", mimeType: "image/png", buffer: PNG });
  expect((await drafted).ok()).toBe(true);

  await expect(form.locator("label:has-text('Name') input")).toHaveValue("Harbor Scout");
  await expect(form.locator("label:has-text('Title') input")).toHaveValue("Tracks ships in port");
  await expect(form.locator("label:has-text('Description') textarea")).toHaveValue(
    "You watch the harbor schedule and flag late arrivals.",
  );
  await expect(form.getByTestId("create-bot-avatar")).toBeVisible();
  const routines = form.getByTestId("create-bot-routines");
  await expect(routines.getByText("Arrivals", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "create-bot-from-image-draft");

  // Drafting alone creates nothing.
  const before = await rpc<Bot[]>(page, "bots/list", {});
  expect(before.some((bot) => bot.name === "Harbor Scout")).toBe(false);

  await form.locator("label:has-text('Name') input").fill("Harbor Scout 2");
  await routines.getByRole("switch").click();
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(page.getByPlaceholder("Message Harbor Scout 2")).toBeVisible();

  const bots = await rpc<Bot[]>(page, "bots/list", {});
  const bot = bots.find((item) => item.name === "Harbor Scout 2");
  expect(bot).toBeTruthy();
  expect(bot?.instructions).toBe("You watch the harbor schedule and flag late arrivals.");
  expect(bot?.title).toBe("Tracks ships in port");
  expect(bot?.color).toBe("#06B6D4::shape_7");
  const created = await rpc<Routine[]>(page, "routines/list", { botId: bot!.id });
  expect(created.map((routine) => [routine.name, routine.watch])).toEqual([["Arrivals", true]]);
});
