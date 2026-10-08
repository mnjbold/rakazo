import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

type Install = {
  id: string;
  kind: string;
  name: string;
  source: string;
  secretConfigured: boolean;
};
type Skill = { id: string; name: string; content: string };

test("skills and plugins shared to the marketplace install for another person", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `market-author-${stamp}@rakazo.test`, "password12", "Market Author");
  await completeOnboarding(page);

  const skillName = `triage-${stamp}`;
  await rpc(page, "agentSkills/create", {
    content: `---\nname: ${skillName}\ndescription: Sort the inbox by urgency.\n---\n\nRead every email.`,
  });
  await rpc(page, "capabilities/install", {
    kind: "mcp",
    name: `Docs MCP ${stamp}`,
    source: "https://mcp.example.test/mcp",
    config: { preset: "custom", auth: { type: "none" } },
  });
  await rpc(page, "capabilities/install", {
    kind: "api",
    name: `Weather API ${stamp}`,
    source: "https://api.example.test/openapi.json",
    config: { openApi: true, auth: { type: "bearer" } },
    credential: "fake-author-openapi-credential",
  });

  // Share both tool sources from Integrations.
  await page.getByText("Integrations").click();
  const advanced = page.getByTestId("integrations-advanced");
  await advanced.evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  for (const name of [`Docs MCP ${stamp}`, `Weather API ${stamp}`]) {
    await page.getByRole("button", { name: `Share ${name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Everyone", exact: true }).click();
    await expect(page.getByRole("button", { name: `Share ${name}`, exact: true })).toHaveText(
      "Shared",
    );
  }
  await captureScreenshot(page, testInfo, "marketplace-share-plugin");
  await page.getByRole("button", { name: "Close integrations" }).click();

  // Share the skill from the bot's Knowledge panel.
  await page
    .locator("main")
    .getByRole("button", { name: /^Chief/ })
    .click();
  const settings = page.getByTestId("bot-settings");
  await settings.getByText("Advanced", { exact: true }).click();
  const knowledge = settings.getByTestId("bot-knowledge");
  await knowledge.getByRole("tab", { name: "Shared skills", exact: true }).click();
  await knowledge.getByRole("button", { name: new RegExp(skillName) }).click();
  await knowledge.getByRole("button", { name: `Share ${skillName}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Everyone", exact: true }).click();
  await expect(
    knowledge.getByRole("button", { name: `Share ${skillName}`, exact: true }),
  ).toHaveText("Shared");
  await captureScreenshot(page, testInfo, "marketplace-share-skill");

  // Another person in another space installs them.
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  const other = await context.newPage();
  await signup(other, `market-installer-${stamp}@rakazo.test`, "password12", "Market Installer");
  await completeOnboarding(other);
  await other.getByText("Integrations").click();
  await other.getByRole("button", { name: "Marketplace", exact: true }).click();
  const market = other.getByTestId("marketplace");
  await expect(market).toBeVisible();

  await market.getByRole("tab", { name: "Skills", exact: true }).click();
  await expect(market.getByText(skillName, { exact: true })).toBeVisible();
  await expect(market.getByRole("button", { name: `Remove ${skillName}` })).toHaveCount(0);
  await market.getByRole("button", { name: `Install ${skillName}`, exact: true }).click();
  await expect(
    market.getByRole("button", { name: `Install ${skillName}`, exact: true }),
  ).toHaveText("Installed");

  await market.getByRole("tab", { name: "Plugins", exact: true }).click();
  await market.getByRole("button", { name: `Install Docs MCP ${stamp}`, exact: true }).click();
  await expect(
    market.getByRole("button", { name: `Install Docs MCP ${stamp}`, exact: true }),
  ).toHaveText("Installed");
  const weather = market.getByRole("button", { name: `Install Weather API ${stamp}`, exact: true });
  await weather.click();
  await market
    .getByRole("textbox", { name: `Credential for Weather API ${stamp}` })
    .fill("fake-installer-openapi-credential");
  await weather.click();
  await expect(weather).toHaveText("Installed");
  await captureScreenshot(other, testInfo, "marketplace-installed");

  const skills = await rpc<Skill[]>(other, "agentSkills/list", {});
  expect(skills.map((skill) => skill.name)).toContain(skillName);
  const installs = await rpc<Install[]>(other, "capabilities/list", {});
  expect(installs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "mcp",
        name: `Docs MCP ${stamp}`,
        source: "https://mcp.example.test/mcp",
        secretConfigured: false,
      }),
      expect.objectContaining({
        kind: "api",
        name: `Weather API ${stamp}`,
        secretConfigured: true,
      }),
    ]),
  );
  const listed = JSON.stringify(await rpc<unknown[]>(other, "marketplace/list", {}));
  expect(listed).not.toContain("fake-author-openapi-credential");
  await context.close();

  // Only the author can remove.
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByText("Integrations").click();
  await page.getByRole("button", { name: "Marketplace", exact: true }).click();
  const ownMarket = page.getByTestId("marketplace");
  await ownMarket.getByRole("tab", { name: "Skills", exact: true }).click();
  await ownMarket.getByRole("button", { name: `Remove ${skillName}`, exact: true }).click();
  await expect(ownMarket.getByText(skillName, { exact: true })).toHaveCount(0);
});
