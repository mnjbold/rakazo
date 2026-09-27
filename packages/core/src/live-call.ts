/** Exact reply a live-call run gives when it should stay quiet (the same token silent routines use). */
export const SILENT_REPLY_TOKEN = "NO_RESPONSE";

/** True when a reply is exactly the silent token (surrounding whitespace ignored). */
export function isSilentReply(text: string): boolean {
  return text.trim() === SILENT_REPLY_TOKEN;
}

/** True while a streaming reply is still empty or could still grow into exactly the silent token. */
export function couldBeSilentReply(partial: string): boolean {
  return SILENT_REPLY_TOKEN.startsWith(partial.trim());
}

/** Silence that ends a live-call turn. */
export const END_OF_TURN_SILENCE_MS = 650;
/** Silence that ends a turn trailing off on a filler or conjunction, when more is likely coming. */
export const TRAILING_OFF_SILENCE_MS = 1_500;

const TRAILING_OFF =
  /\b(?:and|but|so|or|because|cause|then|like|um+|uh+|er+m*|hm+|the|a|an|to|of|with|if)$/i;

/**
 * How long a live call waits in silence before it treats the person's turn as finished: short by
 * default so replies start fast, longer when the words so far trail off ("so I was thinking
 * and"), so a pause mid-thought does not cut them off.
 */
export function endOfTurnSilenceMs(transcript: string): number {
  const text = transcript.trim().replace(/[\s.,;:!?…-]+$/u, "");
  return TRAILING_OFF.test(text) ? TRAILING_OFF_SILENCE_MS : END_OF_TURN_SILENCE_MS;
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
