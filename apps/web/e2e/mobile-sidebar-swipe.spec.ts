import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

/** Sign up, then open the chat by URL so the phone starts on the chat, not the list. */
async function openChiefChat(page: Page, label: string) {
  await prepareOnboarding(page);
  await signup(page, `mobile-${label}-${Date.now()}@rakazo.test`, "password12", "Swipe Test");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  await page.goto(page.url());
  await expect(page.getByPlaceholder("Message Chief")).toBeInViewport();
  await expect(page.getByTestId("bots-sidebar")).not.toBeInViewport();
}

async function prepareOnboarding(page: Page) {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({ response, json: { json: { ...body.json, needsModel: false } } });
  });
  await page.route("**/rpc/integrationSetup/get", (route) =>
    route.fulfill({
      json: {
        json: {
          canConfigure: false,
          needsSetup: false,
          providers: [],
          webUrl: "https://example.test/integrations/setup",
        },
      },
    }),
  );
}

async function swipe(page: Page, start: [number, number], end: [number, number]) {
  await page.getByTestId("shell-root").evaluate(
    (shell, { start, end }) => {
      function touch([clientX, clientY]: [number, number]) {
        return new Touch({ clientX, clientY, identifier: 1, target: shell });
      }
      const first = touch(start);
      shell.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          cancelable: true,
          changedTouches: [first],
          touches: [first],
        }),
      );
      const last = touch(end);
      shell.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          cancelable: true,
          changedTouches: [last],
          touches: [],
        }),
      );
    },
    { start, end },
  );
}

test("phones open on the full-width bot list; a chat goes back to it", async ({
  page,
}, testInfo) => {
  await prepareOnboarding(page);
  await signup(page, `mobile-list-${Date.now()}@rakazo.test`, "password12", "List Test");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const list = page.getByTestId("bots-sidebar");
  await expect(list).toBeInViewport();
  await expect(page.getByTestId("app-rail")).toBeHidden();
  const listBox = await list.boundingBox();
  expect(listBox?.x).toBe(0);
  expect(listBox?.width).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await captureScreenshot(page, testInfo, "mobile-bot-list");

  await list.getByRole("button", { name: /^Chief/ }).tap();
  await expect(list).not.toBeInViewport();
  await expect(page.getByPlaceholder("Message Chief")).toBeInViewport();
  await expect(page.getByTestId("app-rail")).toBeHidden();
  const back = page.getByRole("button", { name: "Back" });
  const backBox = await back.boundingBox();
  expect(backBox?.width).toBeGreaterThanOrEqual(44);
  expect(backBox?.height).toBeGreaterThanOrEqual(44);
  expect(backBox?.x).toBeLessThan(16);
  expect((await page.getByTestId("transcript").boundingBox())?.width).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await captureScreenshot(page, testInfo, "mobile-chat-full-screen");

  await back.tap();
  await expect(list).toBeInViewport();
  await expect(page.locator("main")).toHaveJSProperty("inert", true);
});

for (const width of [360, 430]) {
  test(`the phone list and chat bars fit ${width}px without horizontal scroll`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openChiefChat(page, `fit-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(page.getByTestId("bots-sidebar")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const list = page.getByTestId("bots-sidebar");
    for (const control of [
      list.getByRole("button", { name: "Activity", exact: true }),
      page.getByTestId("create-menu-trigger"),
    ]) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("swiping inward from the mobile edge returns to the bot list", async ({ page }, testInfo) => {
  await openChiefChat(page, "swipe");
  await expect(page.getByTestId("mobile-sidebar-swipe-edge")).toHaveCSS("touch-action", "none");

  await swipe(page, [16, 420], [92, 426]);

  await expect(page.getByTestId("bots-sidebar")).toBeInViewport();
  await expect(page.getByTestId("mobile-sidebar-swipe-edge")).toHaveCount(0);
  await expect(page.getByTestId("bots-sidebar")).toContainText("Chief");
  await captureScreenshot(page, testInfo, "mobile-sidebar-edge-swipe-open");
});

test("the mobile edge swipe follows right-to-left layout direction", async ({ page }) => {
  await openChiefChat(page, "rtl");
  await page.locator("html").evaluate((html) => html.setAttribute("dir", "rtl"));

  const edge = page.getByTestId("mobile-sidebar-swipe-edge");
  const edgeBox = await edge.boundingBox();
  expect(edgeBox?.x).toBeGreaterThan(350);

  await swipe(page, [374, 420], [298, 426]);

  await expect(page.getByTestId("bots-sidebar")).toBeInViewport();
  await expect(page.getByTestId("bots-sidebar")).toContainText("Chief");
});

test("vertical and non-edge swipes stay in the chat", async ({ page }) => {
  await openChiefChat(page, "ignore");
  const list = page.getByTestId("bots-sidebar");
  await swipe(page, [16, 420], [35, 510]);
  await expect(list).not.toBeInViewport();

  await swipe(page, [120, 420], [205, 424]);
  await expect(list).not.toBeInViewport();
});
