import { describe, expect, it, vi } from "vitest";
import { appendMoodEvent, BOT_MOOD_EVENT_LIMIT } from "./bot-mood";
import { rosterAttentionLabel, rosterWorkStatusLabel } from "./roster-status";

vi.mock("@lingui/core/macro", () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
}));

describe("rosterWorkStatusLabel", () => {
  it("names queued, leased, and running work for the sidebar", () => {
    expect(rosterWorkStatusLabel("queued")).toBe("Waiting in line…");
    expect(rosterWorkStatusLabel("leased")).toBe("Starting…");
    expect(rosterWorkStatusLabel("running")).toBe("Working…");
  });

  it("leaves other statuses to the message preview", () => {
    expect(rosterWorkStatusLabel("idle")).toBeNull();
    expect(rosterWorkStatusLabel("waiting_input")).toBeNull();
    expect(rosterWorkStatusLabel("waiting_takeover")).toBeNull();
    expect(rosterWorkStatusLabel("completed")).toBeNull();
    expect(rosterWorkStatusLabel("failed")).toBeNull();
    expect(rosterWorkStatusLabel("cancelled")).toBeNull();
    expect(rosterWorkStatusLabel("")).toBeNull();
  });
});

describe("rosterAttentionLabel", () => {
  it("names needs-you and failed bots and stays silent otherwise", () => {
    expect(rosterAttentionLabel("needs_you")).toBe("needs you");
    expect(rosterAttentionLabel("error")).toBe("failed");
    expect(rosterAttentionLabel(null)).toBeNull();
    expect(rosterAttentionLabel(undefined)).toBeNull();
  });
});

describe("appendMoodEvent", () => {
  const event = (type: string, index = 0) => ({
    type: type as never,
    createdAt: new Date(index).toISOString(),
    runId: "run-1",
    payload: {},
  });

  it("keeps only mood events, newest last, within the window", () => {
    let events = appendMoodEvent([], event("usage.recorded"));
    expect(events).toEqual([]);
    for (let index = 0; index < BOT_MOOD_EVENT_LIMIT + 5; index++) {
      events = appendMoodEvent(events, event("agent.tool.called", index));
    }
    expect(events).toHaveLength(BOT_MOOD_EVENT_LIMIT);
    expect(events.at(-1)?.createdAt).toBe(new Date(BOT_MOOD_EVENT_LIMIT + 4).toISOString());
  });
});
