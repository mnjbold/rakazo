import { expect, test } from "@playwright/test";

test("bot avatar ring stays still when reduced motion is enabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/avatar-motion.html");

  const avatar = page.locator(".rakazo-bot-avatar");
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute("data-working", "true");

  const ring = avatar.locator(".rakazo-bot-avatar-ring");
  await expect(ring).toBeVisible();
  const snapshot = () =>
    ring.evaluate((el: SVGElement) => ({
      animationName: getComputedStyle(el).animationName,
      transform: getComputedStyle(el).transform,
    }));
  const first = await snapshot();
  await page.waitForTimeout(300);
  const second = await snapshot();

  expect(first.animationName).toBe("none");
  expect(second).toEqual(first);
});

test("working avatars keep the idle footprint", async ({ page }) => {
  // Freeze the spin: a rotating square's box grows mid-turn even though the painted ring does not.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/avatar-motion.html");
  const within = (inner: DOMRect, outer: DOMRect) =>
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.bottom <= outer.bottom + 0.5;

  const geometric = page.locator(".rakazo-bot-avatar");
  await expect(geometric).toHaveAttribute("data-working", "true");
  const ringInside = await geometric.evaluate((el) => {
    const ring = el.querySelector(".rakazo-bot-avatar-ring");
    return ring
      ? [ring.getBoundingClientRect().toJSON(), el.getBoundingClientRect().toJSON()]
      : null;
  });
  expect(ringInside).not.toBeNull();
  expect(within(ringInside![0] as DOMRect, ringInside![1] as DOMRect)).toBe(true);

  const organic = page.locator(".rakazo-organic-avatar");
  await expect(organic).toHaveAttribute("data-working", "true");
  const bodyInside = await organic.evaluate((el) => {
    const body = el.querySelector(".rakazo-organic-avatar-body-working");
    return body
      ? [body.getBoundingClientRect().toJSON(), el.getBoundingClientRect().toJSON()]
      : null;
  });
  expect(bodyInside).not.toBeNull();
  expect(within(bodyInside![0] as DOMRect, bodyInside![1] as DOMRect)).toBe(true);
});
