import type { ReplyJudge, ReplyJudgeRequest } from "@rakazo/adapter-kit";
import type { ReplyCheckId } from "@rakazo/contracts";
import { looksCredentialBearing } from "./jev-reply-judge.js";

const JARGON = new Set([
  "api",
  "sdk",
  "json",
  "endpoint",
  "oauth",
  "webhook",
  "docker",
  "kubernetes",
  "regex",
  "latency",
  "schema",
  "cli",
  "repo",
  "middleware",
  "payload",
  "env",
  "runtime",
  "idempotent",
]);
const CLAIM = /\b(done|verified|works|fixed|deployed|completed|tested)\b/i;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Deterministic offline stand-in for a remote reply judge (length, lines, jargon heuristics). */
export class ReplyJudgeEmulator implements ReplyJudge {
  async judge(
    request: ReplyJudgeRequest,
  ): Promise<{ scores: Record<ReplyCheckId, number> } | null> {
    const reply = request.reply.trim();
    if (!reply || looksCredentialBearing(`${request.userRequest}\n${reply}`)) return null;
    const lines = reply.split("\n").filter((line) => line.trim()).length;
    const firstLine = reply.split("\n")[0] ?? "";
    const replyWords = words(reply);
    const jargonHits = replyWords.filter((word) => JARGON.has(word)).length;
    const asked = words(request.userRequest).filter((word) => word.length >= 4);
    const replySet = new Set(replyWords);
    return {
      scores: {
        too_long_or_complex: clamp(Math.max((reply.length - 250) / 750, (lines - 5) / 10)),
        unclear_structure:
          firstLine.length > 200 || (lines === 1 && reply.length > 400) ? 0.8 : 0.1,
        unsupported_claim: CLAIM.test(reply) ? 0.7 : 0.1,
        missed_request: asked.length > 0 && !asked.some((word) => replySet.has(word)) ? 0.6 : 0.1,
        jargon: clamp(jargonHits * 0.3),
      },
    };
  }
}
