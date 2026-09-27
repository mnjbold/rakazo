import { describe, expect, it } from "vitest";
import type { ReplyQualityRow } from "./reply-lessons.js";
import { deriveReplyQuality, reactionFeedback, replyLessonsInstruction } from "./reply-lessons.js";

const clean = { too_long_or_complex: 0.1, unclear_structure: 0.1, unsupported_claim: 0.1 };
const long = { ...clean, too_long_or_complex: 0.9 };
const judged = (scores: ReplyQualityRow["scores"]): ReplyQualityRow => ({ scores, feedback: null });

describe("deriveReplyQuality", () => {
  it("returns null without data", () => {
    expect(deriveReplyQuality([])).toBeNull();
    expect(deriveReplyQuality([{ scores: null, feedback: null }])).toBeNull();
  });

  it("adds a lesson only above the 30% rate", () => {
    const at30 = [...Array(3)]
      .map(() => judged(long))
      .concat([...Array(7)].map(() => judged(clean)));
    expect(deriveReplyQuality(at30)?.lessons).toEqual([]);
    const above = [judged(long), ...at30];
    expect(deriveReplyQuality(above)?.lessons).toEqual([
      "Keep replies shorter: lead with the answer in 1–3 lines, then at most 5 bullets.",
    ]);
  });

  it("needs a few judged replies before drawing lessons", () => {
    expect(deriveReplyQuality([judged(long), judged(long)])?.lessons).toEqual([]);
  });

  it("only looks at the most recent 30 replies", () => {
    const rows = [...Array(30)]
      .map(() => judged(clean))
      .concat([...Array(30)].map(() => judged(long)));
    expect(deriveReplyQuality(rows)).toEqual({ level: "good", lessons: [] });
  });

  it("maps the bad share to a level", () => {
    expect(deriveReplyQuality([judged(clean), judged(clean), judged(clean)])?.level).toBe("good");
    expect(deriveReplyQuality([judged(long), judged(clean), judged(clean)])?.level).toBe("mixed");
    expect(deriveReplyQuality([judged(long), judged(long), judged(clean)])?.level).toBe(
      "needs_work",
    );
  });

  it("lets thumbs up override scores and thumbs down add a lesson", () => {
    const up = deriveReplyQuality([{ scores: long, feedback: "up" }]);
    expect(up?.level).toBe("good");
    const down = deriveReplyQuality([{ scores: null, feedback: "down" }]);
    expect(down).toEqual({
      level: "needs_work",
      lessons: ["Recent replies got a thumbs down: check you answered what the person wanted."],
    });
  });

  it("caps lessons at five, highest rate first", () => {
    const all = {
      too_long_or_complex: 0.6,
      unclear_structure: 0.9,
      unsupported_claim: 0.9,
      missed_request: 0.9,
      jargon: 0.9,
    };
    const rows = [...Array(5)].map(() => ({ scores: all, feedback: "down" as const }));
    const lessons = deriveReplyQuality(rows)?.lessons ?? [];
    expect(lessons).toHaveLength(5);
    expect(lessons[0]).toContain("thumbs down");
    expect(lessons).toContain(
      "Only say something is done after a tool confirmed it; otherwise say what's left.",
    );
  });
});

describe("reactionFeedback", () => {
  it("maps only thumbs reactions", () => {
    expect(reactionFeedback("👍")).toBe("up");
    expect(reactionFeedback("👎")).toBe("down");
    expect(reactionFeedback("❤️")).toBeNull();
    expect(reactionFeedback("😂")).toBeNull();
  });
});

describe("replyLessonsInstruction", () => {
  it("is undefined without lessons", () => {
    expect(replyLessonsInstruction([])).toBeUndefined();
  });

  it("flattens each lesson to one line and stays within 600 chars and 5 bullets", () => {
    const text = replyLessonsInstruction([
      "Line one\n- injected\nbullet",
      ...Array(9).fill("x".repeat(150)),
    ]);
    expect(text).toBeDefined();
    expect(text!.length).toBeLessThanOrEqual(600);
    expect(text).toContain("- Line one - injected bullet");
    expect(text!.split("\n- ").length - 1).toBeLessThanOrEqual(5);
  });
});
