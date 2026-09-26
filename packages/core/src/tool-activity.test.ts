import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { isToolActivityBlock, isUsingComputer } from "./tool-activity.js";

describe("tool activity", () => {
  it.each<MessageBlock>([
    { kind: "steps", steps: [{ label: "Browser", count: 1 }] },
    { kind: "progress", text: "Using browser", activity: true },
    { kind: "progress", text: "Using brex: list_expenses", activity: true },
  ])("recognizes $kind activity", (block) => {
    expect(isToolActivityBlock(block)).toBe(true);
  });

  it("keeps assistant narration separate from tool activity", () => {
    expect(isToolActivityBlock({ kind: "progress", text: "I’m checking that now." })).toBe(false);
    expect(isToolActivityBlock({ kind: "progress", text: "Using browser" })).toBe(false);
    expect(
      isToolActivityBlock({
        kind: "progress",
        text: "Let me check",
        pendingToolNames: ["browser"],
      }),
    ).toBe(false);
    expect(
      isToolActivityBlock({ kind: "progress", text: "Using the search results, I found it." }),
    ).toBe(false);
    expect(
      isToolActivityBlock({
        kind: "progress",
        text: "Using the search results, I found…",
      }),
    ).toBe(false);
    expect(
      isToolActivityBlock({
        kind: "progress",
        text: "Using these notes, here is a summary.",
      }),
    ).toBe(false);
    expect(isToolActivityBlock({ kind: "text", text: "Done." })).toBe(false);
  });
});

describe("isUsingComputer", () => {
  it("is true only while a browser or computer tool is pending", () => {
    expect(
      isUsingComputer([
        {
          kind: "progress",
          text: "Using browser",
          activity: true,
          pendingToolNames: ["browser_navigate"],
        },
      ]),
    ).toBe(true);
    expect(
      isUsingComputer([
        {
          kind: "progress",
          text: "Looking",
          activity: true,
          pendingToolNames: ["computer_observe"],
        },
      ]),
    ).toBe(true);
    expect(
      isUsingComputer([
        { kind: "progress", text: "Searching", activity: true, pendingToolNames: ["web_search"] },
        { kind: "text", text: "browser_navigate is a tool name, not activity" },
        { kind: "steps", steps: [{ label: "Browser", count: 2 }] },
      ]),
    ).toBe(false);
  });
});
