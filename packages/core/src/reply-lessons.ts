import type {
  ReplyCheckId,
  ReplyFeedback,
  ReplyQualitySummary,
  ReplyScores,
} from "@rakazo/contracts";

export type ReplyQualityRow = { scores: ReplyScores | null; feedback: ReplyFeedback | null };

/** How many recent replies feed a bot's lessons. */
export const REPLY_LESSONS_WINDOW = 30;
const FLAGGED = 0.5;
const LESSON_RATE = 0.3;
const MIN_JUDGED = 3;
const MAX_LESSONS = 5;
const MAX_INSTRUCTION_CHARS = 600;

const CHECK_LESSONS: Record<ReplyCheckId, string> = {
  too_long_or_complex:
    "Keep replies shorter: lead with the answer in 1–3 lines, then at most 5 bullets.",
  unsupported_claim:
    "Only say something is done after a tool confirmed it; otherwise say what's left.",
  missed_request: "Answer exactly what was asked before adding anything else.",
  unclear_structure: "Put the answer first, then any details as short bullets.",
  jargon: "Use plain words; explain any technical term in a few words.",
};
const THUMBS_DOWN_LESSON =
  "Recent replies got a thumbs down: check you answered what the person wanted.";

function flagged(scores: ReplyScores | null, check: ReplyCheckId): boolean {
  return (scores?.[check] ?? 0) >= FLAGGED;
}

/**
 * Deterministic lessons from a bot's recent reply scores and owner feedback (newest first).
 * Returns null when there is nothing to learn from yet.
 */
export function deriveReplyQuality(rows: readonly ReplyQualityRow[]): ReplyQualitySummary | null {
  const recent = rows.slice(0, REPLY_LESSONS_WINDOW).filter((row) => row.scores || row.feedback);
  if (recent.length === 0) return null;

  const judged = recent.filter((row) => row.scores);
  const lessons: string[] = [];
  if (judged.length >= MIN_JUDGED) {
    const rates = (Object.keys(CHECK_LESSONS) as ReplyCheckId[])
      .map((check) => ({
        check,
        rate: judged.filter((row) => flagged(row.scores, check)).length / judged.length,
      }))
      .filter(({ rate }) => rate > LESSON_RATE);
    // Stable sort keeps the declared priority on ties.
    rates.sort((a, b) => b.rate - a.rate);
    lessons.push(...rates.map(({ check }) => CHECK_LESSONS[check]));
  }
  const downs = recent.filter((row) => row.feedback === "down").length;
  const ups = recent.filter((row) => row.feedback === "up").length;
  if (downs > ups) lessons.unshift(THUMBS_DOWN_LESSON);

  const bad = recent.filter(
    (row) =>
      row.feedback === "down" ||
      (row.feedback !== "up" &&
        (Object.keys(CHECK_LESSONS) as ReplyCheckId[]).some((check) => flagged(row.scores, check))),
  ).length;
  const badShare = bad / recent.length;
  return {
    level: badShare <= 0.2 ? "good" : badShare <= 0.5 ? "mixed" : "needs_work",
    lessons: lessons.slice(0, MAX_LESSONS),
  };
}

/** 👍 / 👎 on a bot reply are explicit feedback; other reactions are not. */
export function reactionFeedback(reaction: string): ReplyFeedback | null {
  if (reaction === "👍") return "up";
  if (reaction === "👎") return "down";
  return null;
}

/** One short, capped instruction block for the bot's run, or undefined when there are no lessons. */
export function replyLessonsInstruction(lessons: readonly string[]): string | undefined {
  let text = "Your own style lessons from recent reply feedback (the user's request wins):";
  let added = 0;
  for (const lesson of lessons.slice(0, MAX_LESSONS)) {
    const line = `\n- ${lesson.replace(/\s+/g, " ").trim()}`;
    if (text.length + line.length > MAX_INSTRUCTION_CHARS) break;
    text += line;
    added += 1;
  }
  return added > 0 ? text : undefined;
}
