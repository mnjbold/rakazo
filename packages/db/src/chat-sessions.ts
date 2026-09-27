import type { MessageBlock } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES, blocksToAgentHistoryText } from "@rakazo/core";
import type { Prisma, PrismaClient } from "./client.js";
import { appendEventInTransaction } from "./events.js";
import { previewFromBlocks } from "./thread-listing.js";

export const CHAT_SESSION_TITLE_CHARS = 80;
/** Cap for one archived chat's context, both stored and injected into a later run. */
export const CHAT_SESSION_SUMMARY_CHARS = 4_000;
/** How many archived chats a run sees, newest first. */
export const PREVIOUS_CHAT_SESSIONS_IN_CONTEXT = 3;
const EXCERPT_MESSAGE_LIMIT = 40;
const LISTED_CHAT_SESSIONS = 50;

export class ChatSessionBusyError extends Error {
  constructor() {
    super("Stop the current run first.");
    this.name = "ChatSessionBusyError";
  }
}

/** Newest-first transcript lines that fit `budget`, returned in chronological order. */
export function chatTranscriptTail(
  messages: Array<{ role: string; blocks: unknown }>,
  budget: number,
): { text: string; complete: boolean } {
  const parts: string[] = [];
  let used = 0;
  let index = messages.length - 1;
  for (; index >= 0; index -= 1) {
    const message = messages[index]!;
    const text = blocksToAgentHistoryText(message.blocks as MessageBlock[]).trim();
    if (!text) continue;
    const part = `${message.role}: ${text}`;
    const cost = part.length + (parts.length ? 2 : 0);
    if (used + cost > budget) break;
    parts.push(part);
    used += cost;
  }
  return { text: parts.reverse().join("\n\n"), complete: index < 0 };
}

/**
 * Archives the chat currently shown for a bot and starts an empty one. Messages are never moved
 * or deleted: the thread keeps its id (so routines, channels, calls, and watches are unaffected)
 * and only its `sessionStartSeq` boundary advances. Returns null when the current chat is empty.
 */
export async function startNewChatSession(
  prisma: PrismaClient,
  input: { spaceId: string; threadId: string; botId: string },
): Promise<{ sessionId: string; eventSeq: number } | null> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${input.threadId} FOR UPDATE`;
    const thread = await tx.thread.findFirst({
      where: { id: input.threadId, spaceId: input.spaceId, botId: input.botId },
      select: {
        nextMessageSeq: true,
        sessionStartSeq: true,
        historyCompactedUpToSeq: true,
        historyCompactionSummary: true,
      },
    });
    if (!thread) throw new Error("Chat thread not found");
    if (thread.nextMessageSeq <= thread.sessionStartSeq) return null;
    const active = await tx.run.count({
      where: { threadId: input.threadId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    });
    if (active > 0) throw new ChatSessionBusyError();

    const startSeq = thread.sessionStartSeq;
    const endSeq = thread.nextMessageSeq - 1;
    const [firstUserMessage, recent] = await Promise.all([
      tx.message.findFirst({
        where: { threadId: input.threadId, seq: { gte: startSeq }, role: "user" },
        orderBy: { seq: "asc" },
        select: { blocks: true },
      }),
      tx.message.findMany({
        where: { threadId: input.threadId, seq: { gte: startSeq } },
        orderBy: { seq: "desc" },
        take: EXCERPT_MESSAGE_LIMIT,
        select: { role: true, blocks: true },
      }),
    ]);
    // Seed context until the background summarizer replaces it (or for good, when no
    // summarizer model is configured): the chat's compacted summary plus its latest messages.
    const compacted =
      thread.historyCompactedUpToSeq != null && thread.historyCompactedUpToSeq >= startSeq
        ? thread.historyCompactionSummary?.trim()
        : undefined;
    const excerptBudget = CHAT_SESSION_SUMMARY_CHARS - (compacted ? compacted.length + 2 : 0);
    const excerpt =
      excerptBudget > 0 ? chatTranscriptTail(recent.reverse(), excerptBudget).text : "";
    const seed = [compacted, excerpt].filter(Boolean).join("\n\n");
    const session = await tx.chatSession.create({
      data: {
        threadId: input.threadId,
        startSeq,
        endSeq,
        title: previewFromBlocks(firstUserMessage?.blocks).slice(0, CHAT_SESSION_TITLE_CHARS),
        summary: seed ? seed.slice(0, CHAT_SESSION_SUMMARY_CHARS) : null,
      },
      select: { id: true },
    });
    // The new chat starts with a fresh compaction window; the archived chat reaches later runs
    // through its session summary instead. The generation is kept so semantic recall of earlier
    // chats (when a memory provider is configured) keeps working.
    await tx.thread.update({
      where: { id: input.threadId },
      data: {
        sessionStartSeq: thread.nextMessageSeq,
        historyCompactedUpToSeq: endSeq,
        historyCompactionSummary: null,
      },
    });
    // Every client already resets its transcript on thread.cleared, including older builds.
    const event = await appendEventInTransaction(tx, {
      spaceId: input.spaceId,
      threadId: input.threadId,
      botId: input.botId,
      type: "thread.cleared",
      payload: { sessionId: session.id },
    });
    return { sessionId: session.id, eventSeq: event.seq };
  });
}

export async function listChatSessions(prisma: PrismaClient, threadId: string) {
  const rows = await prisma.chatSession.findMany({
    where: { threadId },
    orderBy: { startSeq: "desc" },
    take: LISTED_CHAT_SESSIONS,
    select: { id: true, title: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Seq range of one archived chat, or null when it is not in this thread. */
export function findChatSessionRange(
  prisma: PrismaClient | Prisma.TransactionClient,
  threadId: string,
  sessionId: string,
) {
  return prisma.chatSession.findFirst({
    where: { id: sessionId, threadId },
    select: { startSeq: true, endSeq: true },
  });
}

/** The latest archived chats that have context, oldest first. */
export async function loadPreviousChatSessions(prisma: PrismaClient, threadId: string) {
  const rows = await prisma.chatSession.findMany({
    where: { threadId, summary: { not: null } },
    orderBy: { startSeq: "desc" },
    take: PREVIOUS_CHAT_SESSIONS_IN_CONTEXT,
    select: { title: true, summary: true, createdAt: true },
  });
  return rows.reverse().map((row) => ({
    title: row.title,
    summary: row.summary ?? "",
    endedAt: row.createdAt,
  }));
}
