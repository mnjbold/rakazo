import { expect, test } from "@playwright/test";
import type { Routine } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("a watch preset fills the routine and saves as a silent hourly watch", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `routine-watch-${stamp}@rakazo.test`, "password12", "Routine Watch");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await page.getByTitle("Agent computer").click();
  await page.getByRole("button", { name: "Create Routine" }).click();

  // No Gmail or Calendar connection in this space, so only the connector-free preset shows.
  await expect(page.getByRole("button", { name: "Important email" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Meeting prep" })).toHaveCount(0);
  await page.getByRole("button", { name: "Deadline watch" }).click();
  await expect(page.locator("label:has-text('Name') input")).toHaveValue("Deadline watch");
  await expect(page.locator("label:has-text('Instruction') textarea")).toHaveValue(/stay silent/);
  await captureScreenshot(page, testInfo, "routine-watch-preset");

  const saved = page.waitForResponse(
    (response) => response.url().includes("/rpc/routines/create") && response.ok(),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await saved;
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: /Deadline watch/ })).toContainText("Every hour");

  const [routine] = await rpc<Routine[]>(page, "routines/list", { botId });
  expect(routine).toMatchObject({
    name: "Deadline watch",
    crons: ["0 * * * *"],
    watch: true,
    active: true,
  });

  // Every 5 minutes is below the watch floor, so the API refuses it.
  await expect(
    rpc(page, "routines/update", { routineId: routine!.id, crons: ["*/5 * * * *"] }),
  ).rejects.toThrow("routines/update 400");
});
