import type { BotAttention } from "@rakazo/contracts";
import { isBotWorkingRunStatus, isWaitingRunStatus } from "./run-state.js";

export type { BotAttention };

/** What a bot avatar shows. Highest priority first. */
export const BOT_MOODS = [
  "error",
  "needs_you",
  "trying_hard",
  "working",
  "thinking",
  "happy",
  "listening",
  "sleeping",
  "idle",
] as const;
export type BotMood = (typeof BOT_MOODS)[number];

/** The subset of a ProductEvent the mood reads; oldest first. */
export interface BotMoodEvent {
  type: string;
  createdAt: string;
  runId?: string | null;
  payload?: Record<string, unknown>;
}

export interface BotMoodInput {
  runStatus?: string | null;
  /** Server-derived attention from the bot list; covers bots whose thread is not open. */
  attention?: BotAttention | null;
  /** Recent events of the open thread. Omit for sidebar avatars that only know the status. */
  events?: readonly BotMoodEvent[];
  composerFocused?: boolean;
  voiceActive?: boolean;
  computerSuspended?: boolean;
  now: number;
}

export interface BotMoodState {
  mood: BotMood;
  /** The bot is using its computer (browser, shell, desktop). */
  onComputer: boolean;
  /** When time alone can change the mood; callers re-derive then. */
  changesAt?: number;
}

export const BOT_MOOD_HAPPY_MS = 2_500;
export const BOT_MOOD_TOOL_IDLE_MS = 8_000;
export const BOT_MOOD_LONG_RUN_MS = 10 * 60_000;
export const BOT_MOOD_SLEEP_AFTER_MS = 30 * 60_000;

const COMPUTER_TOOL = /^(computer_|browser_)|^(shell|open_path|launch_app)$/;
const RUN_LIFECYCLE = new Set([
  "run.started",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
]);

/**
 * Server-side attention for a bot list row: waiting on the person, or a failed run the
 * person has not opened yet (the thread is still unread).
 */
export function deriveBotAttention(input: {
  activeRunStatus?: string | null;
  latestRunStatus?: string | null;
  unread: boolean;
}): BotAttention | null {
  if (isWaitingRunStatus(input.activeRunStatus)) return "needs_you";
  if (!input.activeRunStatus && input.latestRunStatus === "failed" && input.unread) return "error";
  return null;
}

function at(event: BotMoodEvent): number {
  return Date.parse(event.createdAt);
}

function toolName(event: BotMoodEvent): string {
  const name = event.payload?.name ?? event.payload?.toolName ?? event.payload?.tool;
  return typeof name === "string" ? name : "";
}

/**
 * The avatar mood from run state and recent events (spec C2). Pure and deterministic:
 * pass `now`, and re-derive at `changesAt` for transient moods.
 */
export function deriveBotMood(input: BotMoodInput): BotMoodState {
  const { now } = input;
  const events = input.events ?? [];
  let lifecycleIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    if (RUN_LIFECYCLE.has(events[index]?.type ?? "")) {
      lifecycleIndex = index;
      break;
    }
  }
  const lifecycle = lifecycleIndex >= 0 ? events[lifecycleIndex] : undefined;
  let startIndex = -1;
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === "run.started") {
      startIndex = index;
      break;
    }
  }
  const runEvents = startIndex >= 0 ? events.slice(startIndex) : events;

  // A terminal event in the stream is fresher than the polled status.
  const terminal =
    lifecycle && lifecycle.type !== "run.started" && lifecycle.type !== "run.waiting_input"
      ? lifecycle
      : undefined;
  const runStatus = terminal ? null : input.runStatus;

  let takeover: "requested" | "granted" | null = null;
  for (const event of runEvents) {
    if (event.type === "computer.takeover.requested") takeover = "requested";
    else if (event.type === "computer.takeover.granted") takeover = "granted";
    else if (event.type === "computer.takeover.released") takeover = null;
  }

  let onComputer = false;
  let lastActivity = Number.NEGATIVE_INFINITY;
  let toolErrors = 0;
  let toolSuccesses = 0;
  const outcomes: boolean[] = [];
  for (const event of runEvents) {
    if (event.type === "agent.tool.called") {
      lastActivity = at(event);
      onComputer = COMPUTER_TOOL.test(toolName(event));
    } else if (event.type === "computer.command") {
      lastActivity = at(event);
      onComputer = true;
    } else if (event.type === "thread.progress" && event.payload?.activity === true) {
      lastActivity = at(event);
    } else if (event.type === "agent.tool.completed") {
      lastActivity = at(event);
      const failed = event.payload?.outcome === "error";
      outcomes.push(!failed);
      if (failed) toolErrors += 1;
      else toolSuccesses += 1;
    }
  }

  if (input.attention === "error" || terminal?.type === "run.failed") {
    return { mood: "error", onComputer: false };
  }
  if (
    input.attention === "needs_you" ||
    isWaitingRunStatus(runStatus) ||
    lifecycle?.type === "run.waiting_input" ||
    takeover === "requested"
  ) {
    return { mood: "needs_you", onComputer: takeover === "requested" };
  }
  if (takeover === "granted") return { mood: "listening", onComputer: true };

  if (isBotWorkingRunStatus(runStatus) || lifecycle?.type === "run.started") {
    if (runStatus === "queued" || runStatus === "leased") {
      return { mood: "thinking", onComputer: false };
    }
    const recent = outcomes.slice(-5);
    const recentErrors = recent.filter((ok) => !ok).length;
    const startedAt = startIndex >= 0 ? at(events[startIndex] as BotMoodEvent) : Number.NaN;
    const elapsed = now - startedAt;
    const slow = elapsed > BOT_MOOD_LONG_RUN_MS && toolSuccesses < elapsed / (2 * 60_000);
    // Two successes in a row end the struggle; the run ending does too.
    const streak = recent.length >= 2 && recent.at(-1) === true && recent.at(-2) === true;
    if (!streak && (toolErrors >= 2 || recentErrors >= 3 || slow)) {
      return { mood: "trying_hard", onComputer };
    }
    if (input.events === undefined) return { mood: "working", onComputer };
    const idleAt = lastActivity + BOT_MOOD_TOOL_IDLE_MS;
    if (now < idleAt) return { mood: "working", onComputer, changesAt: idleAt };
    return { mood: "thinking", onComputer: false };
  }

  const finished = terminal ? at(terminal) : Number.NaN;
  if (terminal?.type === "run.completed" && now - finished < BOT_MOOD_HAPPY_MS) {
    const spoke = events.some(
      (event) =>
        event.runId === terminal.runId &&
        ((event.type === "thread.message.created" && event.payload?.role === "bot") ||
          event.type === "thread.artifact"),
    );
    if (spoke) return { mood: "happy", onComputer: false, changesAt: finished + BOT_MOOD_HAPPY_MS };
  }
  const skill = events.findLast((event) => event.type === "skill.saved");
  if (skill && now - at(skill) < BOT_MOOD_HAPPY_MS) {
    return { mood: "happy", onComputer: false, changesAt: at(skill) + BOT_MOOD_HAPPY_MS };
  }

  if (input.composerFocused || input.voiceActive) return { mood: "listening", onComputer: false };

  const lastEvent = events.at(-1);
  const quietFor = lastEvent ? now - at(lastEvent) : Number.POSITIVE_INFINITY;
  if (input.computerSuspended && quietFor >= BOT_MOOD_SLEEP_AFTER_MS) {
    return { mood: "sleeping", onComputer: false };
  }
  if (input.computerSuspended && lastEvent) {
    return { mood: "idle", onComputer: false, changesAt: at(lastEvent) + BOT_MOOD_SLEEP_AFTER_MS };
  }
  return { mood: "idle", onComputer: false };
}
