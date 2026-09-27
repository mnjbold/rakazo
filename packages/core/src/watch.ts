import { Cron } from "croner";
import { isOneShotRoutineCron } from "./cron.js";
import type { FeaturedConnectorId } from "./featured-connectors.js";
import { matchFeaturedConnectorId } from "./featured-connectors.js";

/** Watches run often; anything tighter than this costs more than it catches. */
export const WATCH_MIN_INTERVAL_MINUTES = 15;

const SAMPLE_RUNS = 96;

/**
 * Shortest gap between consecutive fires across all recurring crons, in minutes.
 * Null when nothing recurs or a cron does not parse.
 */
// ponytail: samples the next 96 fires per cron; a rare short gap further out is missed.
export function shortestCronGapMinutes(
  crons: string[],
  timezone = "UTC",
  from = new Date("2026-01-05T00:00:00Z"),
): number | null {
  // Coinciding fires across crons wake once, so they collapse to one time.
  const fires = new Set<number>();
  for (const cron of crons) {
    if (isOneShotRoutineCron(cron)) continue;
    let schedule: Cron;
    try {
      schedule = new Cron(cron, { paused: true, timezone });
    } catch {
      return null;
    }
    for (const date of schedule.nextRuns(SAMPLE_RUNS, from)) fires.add(date.getTime());
  }
  const times = [...fires].sort((a, b) => a - b);
  if (times.length < 2) return null;
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < times.length; i += 1) {
    shortest = Math.min(shortest, (times[i]! - times[i - 1]!) / 60_000);
  }
  return shortest;
}

/** A watch may not fire more often than every WATCH_MIN_INTERVAL_MINUTES. */
export function watchScheduleAllowed(crons: string[], timezone = "UTC"): boolean {
  const gap = shortestCronGapMinutes(crons, timezone);
  return gap === null || gap >= WATCH_MIN_INTERVAL_MINUTES;
}

export const WATCH_PRESET_IDS = ["important-email", "meeting-prep", "deadline-watch"] as const;
export type WatchPresetId = (typeof WATCH_PRESET_IDS)[number];

export type WatchPreset = {
  id: WatchPresetId;
  prompt: string;
  cron: string;
  /** Offered only when this connector is connected. */
  requires: FeaturedConnectorId | null;
};

export const WATCH_PRESETS: readonly WatchPreset[] = [
  {
    id: "important-email",
    prompt:
      "Check Gmail for unread emails from the last hour that need me: a person asking me something, a deadline, money, or something urgent. Ignore newsletters, promotions, and automated notifications. For each one, write one line: sender, subject, why it matters. If there is nothing, stay silent.",
    cron: "*/30 * * * *",
    requires: "gmail",
  },
  {
    id: "meeting-prep",
    prompt:
      "Check Google Calendar for meetings starting in the next 45 minutes. For each one, write a short prep note: time, attendees, purpose, and anything I should read first. If there is nothing, stay silent.",
    cron: "*/15 * * * *",
    requires: "google-calendar",
  },
  {
    id: "deadline-watch",
    prompt:
      "Check your scratchpad and memory for deadlines due in the next 24 hours. For each one, write one line: what is due and when. If there is nothing, stay silent.",
    cron: "0 * * * *",
    requires: null,
  },
];

/** Presets whose connector is connected (matched by provider slug or display name). */
export function availableWatchPresets(connectedProviders: readonly string[]): WatchPreset[] {
  const connected = new Set(connectedProviders.map(matchFeaturedConnectorId));
  return WATCH_PRESETS.filter((preset) => !preset.requires || connected.has(preset.requires));
}

/** How many earlier watch reports each run sees. */
export const WATCH_REPORTED_LIMIT = 10;
const WATCH_REPORTED_MAX_CHARS = 400;

/** Per-run guidance for a watch: report-only, plus what earlier runs already reported. */
export function watchRunInstruction(previousReports: readonly string[]): string {
  const lines = [
    "This routine is a watch. Only report or ask; never send, reply, delete, pay, book, or change anything.",
  ];
  const reported = previousReports
    .map((text) => text.trim().replace(/\s+/g, " ").slice(0, WATCH_REPORTED_MAX_CHARS))
    .filter(Boolean)
    .slice(0, WATCH_REPORTED_LIMIT);
  if (reported.length > 0) {
    lines.push(
      "Already reported by this watch. Do not report these items again; if nothing else is new, stay silent:",
      ...reported.map((text) => `- ${text}`),
    );
  }
  return lines.join("\n");
}
