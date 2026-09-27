import { expect, type Page, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const WORKING_LOGO = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect width='1' height='1' fill='gray'/></svg>",
)}`;
const BROKEN_LOGO = "/missing-integration-logo.png";

/** Give GitHub a loadable logo and Gmail a broken one; the emulator ships none. */
async function seedCatalogLogos(page: Page) {
  const withLogos = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withLogos);
    if (!value || typeof value !== "object") return value;
    const entry = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, withLogos(child)]),
    );
    if (typeof entry.slug === "string" && "logo" in entry) {
      if (entry.slug.toLowerCase() === "github") entry.logo = WORKING_LOGO;
      if (entry.slug.toLowerCase() === "gmail") entry.logo = BROKEN_LOGO;
    }
    return entry;
  };
  await page.route("**/rpc/connections/catalog**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: withLogos(await response.json()) });
  });
}

async function expectEveryRowHasIcon(page: Page) {
  const rows = page.locator(
    "[data-testid=featured-connectors] > div > *, [data-testid=integration-catalog] > *",
  );
  await expect(page.getByTestId("integration-catalog")).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(5);
  for (let index = 0; index < count; index += 1) {
    await expect(rows.nth(index).locator("[data-integration-icon]")).toHaveCount(1);
  }
}

test("integrations show a logo or monogram in a compact responsive grid", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await seedCatalogLogos(page);
  await signup(page, `integrations-layout-${stamp}@rakazo.test`, "password12", `Layout ${stamp}`);
  await completeOnboarding(page);

  await page.getByText("Integrations").click();
  await expect(page.getByPlaceholder("Search apps")).toBeVisible();
  await expectEveryRowHasIcon(page);

  const featured = page.getByTestId("featured-connectors");
  const gmailIcon = featured
    .getByText("Gmail", { exact: true })
    .locator("xpath=ancestor::*[.//button][1]")
    .locator("[data-integration-icon]");
  await expect(gmailIcon).toHaveAttribute("data-integration-icon", "monogram");
  await expect(gmailIcon).toHaveText("G");
  const githubIcon = page
    .getByTestId("integration-catalog")
    .getByText("GitHub", { exact: true })
    .locator("xpath=ancestor::*[.//button][1]")
    .locator("[data-integration-icon]");
  await expect(githubIcon).toHaveAttribute("data-integration-icon", "logo");
  await expect(githubIcon).toHaveAttribute("alt", "");

  const columns = () =>
    page
      .getByTestId("integration-catalog")
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(await columns()).toBeGreaterThanOrEqual(3);
  await captureScreenshot(page, testInfo, "integrations-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectEveryRowHasIcon(page);
  expect(await columns()).toBeLessThanOrEqual(2);
  const list = page.locator("#integration-list");
  await expect
    .poll(() => list.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const addButton = featured.getByRole("button", { name: "Add", exact: true }).first();
  const rowBox = await addButton.locator("xpath=ancestor::*[.//button][1]").boundingBox();
  expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(40);
  await captureScreenshot(page, testInfo, "integrations-mobile");
});
