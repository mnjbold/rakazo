import type { ProductEvent } from "@rakazo/contracts";
import type { BotMoodEvent, BotMoodInput, BotMoodState } from "@rakazo/core";
import { deriveBotMood } from "@rakazo/core";
import { useEffect, useState } from "react";

/** Recent events kept per open thread for the header avatar's mood. */
export const BOT_MOOD_EVENT_LIMIT = 40;

const MOOD_EVENT_TYPES = new Set<string>([
  "run.started",
  "run.waiting_input",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "agent.tool.called",
  "agent.tool.completed",
  "computer.command",
  "computer.takeover.requested",
  "computer.takeover.granted",
  "computer.takeover.released",
  "thread.progress",
  "thread.message.created",
  "thread.artifact",
  "skill.saved",
  "routine.fired",
]);

/** Append one SSE event to the mood window, keeping only what the mood reads. */
export function appendMoodEvent(
  events: readonly BotMoodEvent[],
  event: Pick<ProductEvent, "type" | "createdAt" | "runId" | "payload">,
): readonly BotMoodEvent[] {
  if (!MOOD_EVENT_TYPES.has(event.type)) return events;
  return [
    ...events,
    {
      type: event.type,
      createdAt: event.createdAt,
      runId: event.runId ?? null,
      payload: event.payload as Record<string, unknown>,
    },
  ].slice(-BOT_MOOD_EVENT_LIMIT);
}

const COMPOSER_NAME = "chat-message";

function composerHasFocus(): boolean {
  return (
    typeof document !== "undefined" &&
    document.activeElement?.getAttribute("name") === COMPOSER_NAME
  );
}

/**
 * The open bot's mood: derived from its thread events, re-derived when a transient mood
 * (happy, working → thinking) expires, and listening while the composer has focus.
 */
export function useBotMood(input: Omit<BotMoodInput, "now" | "composerFocused">): BotMoodState {
  const [composerFocused, setComposerFocused] = useState(composerHasFocus);
  const [, setTick] = useState(0);

  useEffect(() => {
    const update = () => setComposerFocused(composerHasFocus());
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  const state = deriveBotMood({ ...input, composerFocused, now: Date.now() });

  useEffect(() => {
    if (state.changesAt === undefined) return;
    const timer = window.setTimeout(
      () => setTick((tick) => tick + 1),
      Math.max(0, state.changesAt - Date.now()) + 20,
    );
    return () => window.clearTimeout(timer);
  }, [state.changesAt]);

  return state;
}
