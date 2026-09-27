import { describe, expect, it } from "vitest";
import {
  availableWatchPresets,
  shortestCronGapMinutes,
  WATCH_MIN_INTERVAL_MINUTES,
  WATCH_PRESETS,
  WATCH_REPORTED_LIMIT,
  watchRunInstruction,
  watchScheduleAllowed,
} from "./watch.js";

describe("watch schedules", () => {
  it("measures the shortest gap across every cron", () => {
    expect(shortestCronGapMinutes(["*/15 * * * *"])).toBe(15);
    expect(shortestCronGapMinutes(["0 * * * *"])).toBe(60);
    expect(shortestCronGapMinutes(["0 * * * *", "5 * * * *"])).toBe(5);
    expect(shortestCronGapMinutes(["0,5 9 * * *"])).toBe(5);
    expect(shortestCronGapMinutes([])).toBeNull();
    expect(shortestCronGapMinutes(["@once"])).toBeNull();
    expect(shortestCronGapMinutes(["not a cron"])).toBeNull();
  });

  it("allows every 15 minutes or slower and rejects anything tighter", () => {
    expect(WATCH_MIN_INTERVAL_MINUTES).toBe(15);
    expect(watchScheduleAllowed(["*/15 * * * *"])).toBe(true);
    expect(watchScheduleAllowed(["*/30 * * * *", "0 9 * * *"])).toBe(true);
    expect(watchScheduleAllowed(["*/10 * * * *"])).toBe(false);
    expect(watchScheduleAllowed(["* * * * *"])).toBe(false);
    expect(watchScheduleAllowed(["0 * * * *", "10 * * * *"])).toBe(false);
  });
});

describe("watch presets", () => {
  it("run within the interval floor and tell the bot when to stay silent", () => {
    expect(WATCH_PRESETS.map((preset) => preset.id)).toEqual([
      "important-email",
      "meeting-prep",
      "deadline-watch",
    ]);
    for (const preset of WATCH_PRESETS) {
      expect(watchScheduleAllowed([preset.cron])).toBe(true);
      expect(preset.prompt).toContain("stay silent");
      expect(preset.prompt.length).toBeLessThan(400);
    }
  });

  it("offers connector presets only when that connector is connected", () => {
    expect(availableWatchPresets([]).map((preset) => preset.id)).toEqual(["deadline-watch"]);
    expect(availableWatchPresets(["gmail"]).map((preset) => preset.id)).toEqual([
      "important-email",
      "deadline-watch",
    ]);
    expect(availableWatchPresets(["googlecalendar", "Gmail"]).map((preset) => preset.id)).toEqual([
      "important-email",
      "meeting-prep",
      "deadline-watch",
    ]);
  });
});

describe("watchRunInstruction", () => {
  it("is report-only and lists nothing when there is no history", () => {
    const text = watchRunInstruction([]);
    expect(text).toContain("Only report or ask");
    expect(text).not.toContain("Already reported");
  });

  it("lists earlier reports, collapsed and capped", () => {
    const text = watchRunInstruction([
      "  Invoice from Acme\n\nis overdue  ",
      "",
      ...Array.from({ length: 20 }, (_, i) => `item ${i}`),
    ]);
    expect(text).toContain("- Invoice from Acme is overdue");
    expect(text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(
      WATCH_REPORTED_LIMIT,
    );
    expect(watchRunInstruction(["x".repeat(2000)]).length).toBeLessThan(700);
  });
});
