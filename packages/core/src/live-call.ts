/** Exact reply a live-call run gives when it should stay quiet (the same token silent routines use). */
export const SILENT_REPLY_TOKEN = "NO_RESPONSE";

/** True when a reply is exactly the silent token (surrounding whitespace ignored). */
export function isSilentReply(text: string): boolean {
  return text.trim() === SILENT_REPLY_TOKEN;
}

export const LIVE_CALL_INSTRUCTION = [
  "You are in a live voice call as the user's always-on assistant, not a chatbot.",
  `If the speech is not addressed to you, is background noise or other people talking, or needs no response, reply with exactly ${SILENT_REPLY_TOKEN} and nothing else.`,
  'Otherwise answer in one to three short spoken sentences. No markdown, no lists read aloud, never repeat what you already said, and no filler like "Great question" or "As an AI".',
  "Keep working on the task silently and only speak when you have a result, need a decision, or something needs the user's attention.",
].join(" ");

/** System-prompt block for a run, present only when the run is a live call. */
export function liveCallInstruction(live: boolean | null | undefined): string | undefined {
  return live ? LIVE_CALL_INSTRUCTION : undefined;
}

/**
 * Per-turn guidance when the person talked over the bot's previous spoken reply, so the model
 * knows they heard only part of it. Only for live runs that carry what was heard.
 */
export function liveInterruptionInstruction(
  live: boolean | null | undefined,
  heard: string | null | undefined,
): string | undefined {
  const text = heard?.trim();
  if (!live || !text) return undefined;
  return `The person interrupted your previous reply; they heard only: ${JSON.stringify(text)}. Don't repeat what they heard; address what they just said, then finish anything important they missed only if it still matters.`;
}
