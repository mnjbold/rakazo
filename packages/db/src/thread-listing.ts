import type { BotAttention } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES, deriveBotAttention, plainTextFromMarkdown } from "@rakazo/core";
import type { PrismaClient } from "./client.js";

export const activeRunStatuses = [...ACTIVE_RUN_STATUSES];

export const activeRunSelection = {
  where: { status: { in: activeRunStatuses } },
  orderBy: { createdAt: "desc" as const },
  take: 1,
  select: { status: true },
} as const;

/**
 * Sidebar attention for listed bots. Only unread bots without an active run can carry an
 * unseen failure, so only those look up their newest run in their own thread.
 */
export async function listBotAttention(
  prisma: PrismaClient,
  bots: readonly {
    id: string;
    thread: { id: string; unread: boolean } | null;
    runs: readonly { status: string }[];
  }[],
): Promise<Map<string, BotAttention | null>> {
  const latest = await Promise.all(
    bots.map((bot) =>
      bot.thread?.unread && !bot.runs[0]
        ? prisma.run.findFirst({
            where: { threadId: bot.thread.id, botId: bot.id },
            orderBy: { createdAt: "desc" },
            select: { status: true },
          })
        : null,
    ),
  );
  return new Map(
    bots.map((bot, index) => [
      bot.id,
      deriveBotAttention({
        activeRunStatus: bot.runs[0]?.status,
        latestRunStatus: latest[index]?.status,
        unread: bot.thread?.unread ?? false,
      }),
    ]),
  );
}

export function previewFromBlocks(blocks: unknown): string {
  const rows = Array.isArray(blocks) ? blocks : [];
  for (const block of rows) {
    if (
      block &&
      typeof block === "object" &&
      "text" in block &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      return plainTextFromMarkdown((block as { text: string }).text);
    }
  }
  return "";
}
