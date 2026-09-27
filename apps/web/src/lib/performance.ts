export function markOnce(name: string) {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

export function markAfterPaint(name: string) {
  if (performance.getEntriesByName(name).length > 0) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => markOnce(name));
  });
}

const END_OF_SPEECH = "rk:call:end-of-speech";
export const REPLY_LATENCY = "rk:call:end-of-speech-to-audio";

/** The person stopped talking on a call; the next reply audio closes the measure. */
export function markEndOfSpeech() {
  performance.clearMarks(END_OF_SPEECH);
  performance.mark(END_OF_SPEECH);
}

/** Reply audio started: measures end of speech → first audio, once per turn. */
export function measureReplyLatency() {
  if (performance.getEntriesByName(END_OF_SPEECH, "mark").length === 0) return;
  performance.measure(REPLY_LATENCY, END_OF_SPEECH);
  performance.clearMarks(END_OF_SPEECH);
}
