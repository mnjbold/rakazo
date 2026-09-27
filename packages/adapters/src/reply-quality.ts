import type { ReplyJudge } from "@rakazo/adapter-kit";
import type { ReplyFeedback, ReplyQualitySummary, ReplyScores } from "@rakazo/contracts";
import { deriveReplyQuality, REPLY_LESSONS_WINDOW } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { NO_RESPONSE } from "./silent-reply.js";

/** People-facing turns only: routines, intros, webhooks and bot-to-bot runs are not judged. */
export const JUDGED_REPLY_TRIGGERS = new Set(["user", "follow_up", "messaging"]);

function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) =>
      block && typeof block === "object" && block.kind === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** `reply.judge` handler: score a completed run's visible reply. Never throws on judge failure. */
export async function judgeRunReply(
  deps: { prisma: PrismaClient; judge: ReplyJudge | null | undefined },
  runId: string,
): Promise<void> {
  if (!deps.judge) return;
  const run = await deps.prisma.run.findUnique({
    where: { id: runId },
    select: {
      status: true,
      botId: true,
      spaceId: true,
      threadId: true,
      sourceMessage: { select: { blocks: true } },
      task: { select: { prompt: true } },
      bot: { select: { instructions: true } },
    },
  });
  if (run?.status !== "completed") return;
  const messages = await deps.prisma.message.findMany({
    where: { threadId: run.threadId, runId, role: "bot" },
    orderBy: { seq: "asc" },
    select: { blocks: true },
  });
  const reply = messages
    .map((message) => blocksText(message.blocks))
    .join("\n")
    .trim();
  if (!reply || reply === NO_RESPONSE) return;
  const userRequest = blocksText(run.sourceMessage?.blocks) || run.task.prompt;
  const result = await deps.judge
    .judge({ userRequest, reply, botInstructions: run.bot.instructions })
    .catch(() => null);
  if (!result) return;
  await deps.prisma.replyQuality.upsert({
    where: { runId },
    create: { runId, botId: run.botId, spaceId: run.spaceId, scores: result.scores },
    update: { scores: result.scores },
  });
}

/** Recent quality for one bot, newest first. Null when nothing is recorded or on read errors. */
export async function loadReplyQuality(
  prisma: PrismaClient,
  botId: string,
): Promise<ReplyQualitySummary | null> {
  try {
    const rows = await prisma.replyQuality.findMany({
      where: { botId },
      orderBy: { createdAt: "desc" },
      take: REPLY_LESSONS_WINDOW,
      select: { scores: true, feedback: true },
    });
    return deriveReplyQuality(
      rows.map((row) => ({
        scores: (row.scores as ReplyScores | null) ?? null,
        feedback: row.feedback === "up" || row.feedback === "down" ? row.feedback : null,
      })),
    );
  } catch (error) {
    getLogger().error("reply quality load failed", error);
    return null;
  }
}

/** Store the bot owner's thumbs reaction on a bot reply. */
export async function recordReplyFeedback(
  prisma: Pick<PrismaClient, "replyQuality">,
  input: { runId: string; botId: string; spaceId: string; feedback: ReplyFeedback },
): Promise<void> {
  await prisma.replyQuality.upsert({
    where: { runId: input.runId },
    create: input,
    update: { feedback: input.feedback },
  });
}
