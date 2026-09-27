import { expect, test } from "@playwright/test";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  openNewBot,
  rpc,
  signup,
} from "./helpers";

type BotRow = { id: string; name: string; title: string; instructions: string };

test("a bot shared as a template creates a new bot from the gallery", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `bot-templates-${stamp}@rakazo.test`, "password12", "Template Author");
  await completeOnboarding(page);

  const instructions = "Always answer with three bullet points and cite one source.";
  const source = await rpc<BotRow>(page, "bots/create", {
    name: "Scout",
    title: "Research scout",
    description: "",
    instructions,
    notifyOnFinish: true,
    computerMode: "team",
  });
  await page.goto(`/app/${source.id}`);
  await expect(page.getByPlaceholder("Message Scout")).toBeVisible();

  const sidebar = page.locator("aside").first();
  await sidebar.getByRole("button", { name: /^Scout/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Share as template", exact: true }).hover();
  await page.getByRole("menuitem", { name: "This space", exact: true }).click();

  const panel = page.getByTestId("side-panel");
  await expect(panel).toHaveAttribute("data-panel", "create");
  const gallery = page.getByTestId("bot-templates");
  await expect(gallery).toContainText("Scout");
  await expect(gallery).toContainText("Research scout");
  await captureScreenshot(page, testInfo, "bot-templates-gallery");

  await gallery.getByRole("button", { name: "Use template Scout", exact: true }).click();
  await expect(panel).toHaveAttribute("data-panel", "closed");
  await expect.poll(() => activeBotId(page)).not.toBe(source.id);
  const createdId = activeBotId(page);
  await expect(page.getByPlaceholder("Message Scout")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Scout/ })).toHaveCount(2);

  const created = await rpc<BotRow>(page, "bots/get", { botId: createdId });
  expect(created).toMatchObject({ name: "Scout", title: "Research scout", instructions });
  await captureScreenshot(page, testInfo, "bot-templates-used");

  await openNewBot(page);
  await gallery.getByRole("button", { name: "Remove template Scout", exact: true }).click();
  await expect(gallery).toBeHidden();
  await expect(rpc<unknown[]>(page, "botTemplates/list", {})).resolves.toEqual([]);
});
