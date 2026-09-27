import * as z from "zod";

/** Checks a reply judge scores, each a 0–1 probability that the reply has the problem. */
export const REPLY_CHECK_IDS = [
  "too_long_or_complex",
  "unclear_structure",
  "unsupported_claim",
  "missed_request",
  "jargon",
] as const;
export type ReplyCheckId = (typeof REPLY_CHECK_IDS)[number];
export type ReplyScores = Partial<Record<ReplyCheckId, number>>;

export type ReplyFeedback = "up" | "down";

export const ReplyQualitySummarySchema = z.object({
  level: z.enum(["good", "mixed", "needs_work"]),
  lessons: z.array(z.string()),
});
export type ReplyQualitySummary = z.infer<typeof ReplyQualitySummarySchema>;
