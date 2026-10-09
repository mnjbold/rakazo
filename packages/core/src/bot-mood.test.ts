import { describe, expect, it } from "vitest";
import type { BotMoodEvent } from "./bot-mood.js";
import { BOT_MOOD_HAPPY_MS, deriveBotAttention, deriveBotMood } from "./bot-mood.js";
import { JEWEL_CUTS, jewelCut } from "./jewel.js";
import { ACTIVE_RUN_STATUSES, isBotWorkingRunStatus, isWaitingRunStatus } from "./run-state.js";

const T0 = Date.parse("2026-10-09T10:00:00.000Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const event = (
  type: string,
  ms: number,
  payload: Record<string, unknown> = {},
  runId = "run-1",
): BotMoodEvent => ({ type, createdAt: iso(ms), runId, payload });

describe("run status display split", () => {
  it("keeps waiting runs active for scheduling but not working for display", () => {
    expect(ACTIVE_RUN_STATUSES).toContain("waiting_input");
    expect(ACTIVE_RUN_STATUSES).toContain("waiting_takeover");
    expect(isWaitingRunStatus("waiting_input")).toBe(true);
    expect(isWaitingRunStatus("waiting_takeover")).toBe(true);
    expect(isBotWorkingRunStatus("waiting_input")).toBe(false);
    expect(isBotWorkingRunStatus("running")).toBe(true);
    expect(isBotWorkingRunStatus("queued")).toBe(true);
    expect(isBotWorkingRunStatus("idle")).toBe(false);
    expect(isWaitingRunStatus(undefined)).toBe(false);
  });
});

describe("deriveBotAttention", () => {
  it("asks for the person while a run waits on input or takeover", () => {
    expect(deriveBotAttention({ activeRunStatus: "waiting_input", unread: false })).toBe(
      "needs_you",
    );
    expect(deriveBotAttention({ activeRunStatus: "waiting_takeover", unread: true })).toBe(
      "needs_you",
    );
  });

  it("flags an unseen failed run and clears once the thread is read", () => {
    expect(deriveBotAttention({ latestRunStatus: "failed", unread: true })).toBe("error");
    expect(deriveBotAttention({ latestRunStatus: "failed", unread: false })).toBeNull();
  });

  it("stays calm for working, finished, and idle bots", () => {
    expect(deriveBotAttention({ activeRunStatus: "running", unread: true })).toBeNull();
    expect(deriveBotAttention({ latestRunStatus: "completed", unread: true })).toBeNull();
    expect(deriveBotAttention({ latestRunStatus: "cancelled", unread: true })).toBeNull();
    expect(deriveBotAttention({ unread: false })).toBeNull();
  });

  it("lets a new active run replace an earlier failure", () => {
    expect(
      deriveBotAttention({ activeRunStatus: "running", latestRunStatus: "failed", unread: true }),
    ).toBeNull();
  });
});

describe("deriveBotMood from status only (sidebar)", () => {
  it.each([
    ["running", "working"],
    ["queued", "thinking"],
    ["leased", "thinking"],
    ["waiting_input", "needs_you"],
    ["waiting_takeover", "needs_you"],
    ["idle", "idle"],
    ["completed", "idle"],
  ])("maps %s to %s", (runStatus, mood) => {
    expect(deriveBotMood({ runStatus, now: T0 }).mood).toBe(mood);
  });

  it("puts error attention above everything and needs-you above working", () => {
    expect(deriveBotMood({ runStatus: "running", attention: "error", now: T0 }).mood).toBe("error");
    expect(deriveBotMood({ runStatus: "running", attention: "needs_you", now: T0 }).mood).toBe(
      "needs_you",
    );
  });
});

describe("deriveBotMood from events (open thread)", () => {
  it("thinks after the run starts, then works while tools run", () => {
    const started = [event("run.started", 0)];
    expect(deriveBotMood({ runStatus: "running", events: started, now: T0 + 500 }).mood).toBe(
      "thinking",
    );
    const tool = [...started, event("agent.tool.called", 1_000, { name: "web_search" })];
    const working = deriveBotMood({ runStatus: "running", events: tool, now: T0 + 2_000 });
    expect(working).toEqual({ mood: "working", onComputer: false, changesAt: T0 + 9_000 });
    expect(deriveBotMood({ runStatus: "running", events: tool, now: T0 + 9_000 }).mood).toBe(
      "thinking",
    );
  });

  it("marks computer tools and commands as on-computer work", () => {
    for (const name of [
      "browser_click",
      "computer_screenshot",
      "shell",
      "open_path",
      "launch_app",
    ]) {
      const events = [event("run.started", 0), event("agent.tool.called", 100, { name })];
      expect(deriveBotMood({ runStatus: "running", events, now: T0 + 200 })).toMatchObject({
        mood: "working",
        onComputer: true,
      });
    }
    const command = [event("run.started", 0), event("computer.command", 100)];
    expect(deriveBotMood({ runStatus: "running", events: command, now: T0 + 200 }).onComputer).toBe(
      true,
    );
  });

  it("tries hard after repeated tool errors until a success streak", () => {
    const errors = [
      event("run.started", 0),
      event("agent.tool.completed", 100, { outcome: "error" }),
      event("agent.tool.completed", 200, { outcome: "error" }),
    ];
    expect(deriveBotMood({ runStatus: "running", events: errors, now: T0 + 300 }).mood).toBe(
      "trying_hard",
    );
    const recovered = [
      ...errors,
      event("agent.tool.completed", 400, { outcome: "succeeded" }),
      event("agent.tool.completed", 500, { outcome: "succeeded" }),
    ];
    expect(deriveBotMood({ runStatus: "running", events: recovered, now: T0 + 600 }).mood).toBe(
      "working",
    );
  });

  it("tries hard on a long run with too few successes", () => {
    const events = [
      event("run.started", 0),
      event("thread.progress", 11 * 60_000, { activity: true }),
    ];
    expect(deriveBotMood({ runStatus: "running", events, now: T0 + 11 * 60_000 + 10 }).mood).toBe(
      "trying_hard",
    );
  });

  it("needs the person on waiting input and on a takeover request", () => {
    const waiting = [event("run.started", 0), event("run.waiting_input", 100)];
    expect(deriveBotMood({ events: waiting, now: T0 + 200 }).mood).toBe("needs_you");
    const takeover = [event("run.started", 0), event("computer.takeover.requested", 100)];
    expect(deriveBotMood({ runStatus: "running", events: takeover, now: T0 + 200 })).toMatchObject({
      mood: "needs_you",
      onComputer: true,
    });
  });

  it("listens while the person drives the computer, then thinks again", () => {
    const granted = [
      event("run.started", 0),
      event("computer.takeover.requested", 100),
      event("computer.takeover.granted", 200),
    ];
    expect(deriveBotMood({ runStatus: "running", events: granted, now: T0 + 300 }).mood).toBe(
      "listening",
    );
    const released = [...granted, event("computer.takeover.released", 300)];
    expect(deriveBotMood({ runStatus: "running", events: released, now: T0 + 400 }).mood).toBe(
      "thinking",
    );
  });

  it("is happy briefly after a run that replied, then idle", () => {
    const events = [
      event("run.started", 0),
      event("thread.message.created", 900, { role: "bot" }),
      event("run.completed", 1_000),
    ];
    const happy = deriveBotMood({ runStatus: "running", events, now: T0 + 1_100 });
    expect(happy).toEqual({
      mood: "happy",
      onComputer: false,
      changesAt: T0 + 1_000 + BOT_MOOD_HAPPY_MS,
    });
    expect(deriveBotMood({ events, now: T0 + 1_000 + BOT_MOOD_HAPPY_MS }).mood).toBe("idle");
  });

  it("stays calm after a silent routine run", () => {
    const events = [event("run.started", 0), event("run.completed", 1_000)];
    expect(deriveBotMood({ events, now: T0 + 1_100 }).mood).toBe("idle");
  });

  it("shows error after a failed run until the next run starts", () => {
    const failed = [event("run.started", 0), event("run.failed", 100)];
    expect(deriveBotMood({ runStatus: "running", events: failed, now: T0 + 200 }).mood).toBe(
      "error",
    );
    const next = [...failed, event("run.started", 300, {}, "run-2")];
    expect(deriveBotMood({ runStatus: "running", events: next, now: T0 + 400 }).mood).toBe(
      "thinking",
    );
  });

  it("listens while the composer has focus and the bot is idle", () => {
    expect(deriveBotMood({ composerFocused: true, now: T0 }).mood).toBe("listening");
    expect(deriveBotMood({ voiceActive: true, now: T0 }).mood).toBe("listening");
    expect(deriveBotMood({ runStatus: "running", composerFocused: true, now: T0 }).mood).toBe(
      "working",
    );
  });

  it("sleeps when the computer is suspended and nothing happened for half an hour", () => {
    const events = [event("run.completed", 0)];
    const awake = deriveBotMood({ events, computerSuspended: true, now: T0 + 60_000 });
    expect(awake).toEqual({ mood: "idle", onComputer: false, changesAt: T0 + 30 * 60_000 });
    expect(deriveBotMood({ events, computerSuspended: true, now: T0 + 30 * 60_000 }).mood).toBe(
      "sleeping",
    );
    expect(deriveBotMood({ computerSuspended: true, now: T0 }).mood).toBe("sleeping");
    expect(deriveBotMood({ events: [], computerSuspended: false, now: T0 }).mood).toBe("idle");
  });
});

describe("jewelCut", () => {
  it("is deterministic per seed and covers all eight cuts", () => {
    expect(jewelCut(42)).toEqual(jewelCut(42));
    const names = new Set(Array.from({ length: 400 }, (_, seed) => jewelCut(seed).name));
    expect([...names].sort()).toEqual([...JEWEL_CUTS].sort());
  });

  it("builds a crown table plus 6-12 shaded facets with two eye facets inside the gem", () => {
    for (let seed = 0; seed < 64; seed++) {
      const cut = jewelCut(seed);
      expect(cut.facets.length).toBeGreaterThanOrEqual(6);
      expect(cut.facets.length).toBeLessThanOrEqual(12);
      expect(new Set(cut.facets.map((facet) => facet.shade)).size).toBeGreaterThan(1);
      expect(cut.eyes.leftX).toBeLessThan(cut.eyes.rightX);
      for (const value of [cut.eyes.leftX, cut.eyes.rightX, cut.eyes.y]) {
        expect(Math.abs(value)).toBeLessThan(40);
      }
      expect(cut.blinkSeconds).toBeGreaterThanOrEqual(3);
      expect(cut.blinkSeconds).toBeLessThanOrEqual(7);
      expect(cut.delaySeconds).toBeLessThanOrEqual(0);
    }
  });

  it("de-syncs glints between bots", () => {
    const timings = new Set(
      Array.from(
        { length: 20 },
        (_, seed) => `${jewelCut(seed).glintSeconds}:${jewelCut(seed).delaySeconds}`,
      ),
    );
    expect(timings.size).toBeGreaterThan(10);
  });
});
