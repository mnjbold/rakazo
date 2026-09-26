import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("a long reply collapses to one screenful with Show more", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `long-${stamp}@rakazo.test`, "password12", `Long ${stamp}`);
  await completeOnboarding(page);

  // Serve the real thread with one long bot reply appended, as a verbose model would write.
  const longText = Array.from(
    { length: 40 },
    (_, i) => `Line ${i + 1} of a detailed answer that keeps going.`,
  ).join("\n\n");
  type Snapshot = { messages: Array<{ threadId: string; seq: number }> } | null | undefined;
  const withLongReply = (snapshot: Snapshot) => {
    const last = snapshot?.messages.at(-1);
    if (!snapshot || !last) return;
    snapshot.messages.push({
      id: "long-reply",
      threadId: last.threadId,
      seq: last.seq + 1,
      role: "bot",
      blocks: [{ kind: "text", text: longText }],
      createdAt: new Date().toISOString(),
    } as never);
  };
  // The first thread arrives inside bootstrap; later refreshes use threads/get.
  await page.route("**/rpc/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    withLongReply(body.json?.thread);
    await route.fulfill({ response, json: body });
  });
  await page.route("**/rpc/threads/get", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    withLongReply(body.json);
    await route.fulfill({ response, json: body });
  });
  await page.reload();

  const reply = page.getByTestId("message-bot-bubble").filter({ hasText: "Line 1 of" }).last();
  await expect(reply).toBeVisible({ timeout: 30_000 });
  const showMore = reply.getByRole("button", { name: "Show more" });
  await expect(showMore).toBeVisible();
  expect((await reply.boundingBox())?.height ?? 0).toBeLessThan(400);
  await captureScreenshot(page, testInfo, "long-reply-collapsed");

  await showMore.click();
  await expect(reply.getByRole("button", { name: "Show less" })).toBeVisible();
  expect((await reply.boundingBox())?.height ?? 0).toBeGreaterThan(400);
});
