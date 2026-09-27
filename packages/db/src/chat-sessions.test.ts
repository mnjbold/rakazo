import { describe, expect, it, vi } from "vitest";
import {
  ChatSessionBusyError,
  chatTranscriptTail,
  loadPreviousChatSessions,
  startNewChatSession,
} from "./chat-sessions.js";
import type { PrismaClient } from "./client.js";

const text = (value: string) => [{ kind: "text", text: value }];

function fakeDb(options: {
  nextMessageSeq: number;
  sessionStartSeq?: number;
  activeRuns?: number;
  compactedUpTo?: number | null;
  compactedSummary?: string | null;
}) {
  const messages = Array.from({ length: options.nextMessageSeq }, (_, seq) => ({
    seq,
    role: seq % 2 === 0 ? "user" : "bot",
    blocks: text(`message ${seq}`),
  }));
  const tx = {
    $queryRaw: vi.fn(async () => []),
    thread: {
      findFirst: vi.fn(async () => ({
        nextMessageSeq: options.nextMessageSeq,
        sessionStartSeq: options.sessionStartSeq ?? 0,
        historyCompactedUpToSeq: options.compactedUpTo ?? null,
        historyCompactionSummary: options.compactedSummary ?? null,
      })),
      update: vi.fn(async () => ({ nextEventSeq: 8 })),
    },
    run: { count: vi.fn(async () => options.activeRuns ?? 0), findUnique: vi.fn() },
    message: {
      findFirst: vi.fn(
        async (args: { where: { seq: { gte: number } } }) =>
          messages.find((m) => m.role === "user" && m.seq >= args.where.seq.gte) ?? null,
      ),
      findMany: vi.fn(async (args: { where: { seq: { gte: number } }; take: number }) =>
        messages
          .filter((m) => m.seq >= args.where.seq.gte)
          .reverse()
          .slice(0, args.take),
      ),
    },
    chatSession: { create: vi.fn(async () => ({ id: "session-1" })) },
    event: { create: vi.fn(async (args: { data: { seq: number } }) => ({ seq: args.data.seq })) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  return { tx, prisma };
}

const input = { spaceId: "space-1", threadId: "thread-1", botId: "bot-1" };

describe("startNewChatSession", () => {
  it("archives the current chat and moves the boundary without deleting messages", async () => {
    const { tx, prisma } = fakeDb({ nextMessageSeq: 6, sessionStartSeq: 2 });

    await expect(startNewChatSession(prisma, input)).resolves.toEqual({
      sessionId: "session-1",
      eventSeq: 7,
    });

    expect(tx.chatSession.create).toHaveBeenCalledWith({
      data: {
        threadId: "thread-1",
        startSeq: 2,
        endSeq: 5,
        title: "message 2",
        summary: "user: message 2\n\nbot: message 3\n\nuser: message 4\n\nbot: message 5",
      },
      select: { id: true },
    });
    expect(tx.thread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: { sessionStartSeq: 6, historyCompactedUpToSeq: 5, historyCompactionSummary: null },
    });
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "thread.cleared",
        payload: { sessionId: "session-1" },
      }),
    });
  });

  it("seeds the archived chat with its compacted summary", async () => {
    const { tx, prisma } = fakeDb({
      nextMessageSeq: 4,
      compactedUpTo: 1,
      compactedSummary: "Chose Lisbon.",
    });
    await startNewChatSession(prisma, input);
    const [{ data }] = tx.chatSession.create.mock.calls[0] as unknown as [
      { data: { summary: string } },
    ];
    expect(data.summary.startsWith("Chose Lisbon.\n\nuser: message 0")).toBe(true);
  });

  it("does nothing when the current chat is already empty", async () => {
    const { tx, prisma } = fakeDb({ nextMessageSeq: 3, sessionStartSeq: 3 });
    await expect(startNewChatSession(prisma, input)).resolves.toBeNull();
    expect(tx.chatSession.create).not.toHaveBeenCalled();
    expect(tx.thread.update).not.toHaveBeenCalled();
  });

  it("refuses while a run is active so no reply lands in the wrong chat", async () => {
    const { tx, prisma } = fakeDb({ nextMessageSeq: 3, activeRuns: 1 });
    await expect(startNewChatSession(prisma, input)).rejects.toBeInstanceOf(ChatSessionBusyError);
    expect(tx.chatSession.create).not.toHaveBeenCalled();
  });

  it("only matches the thread of this bot in this space", async () => {
    const { tx, prisma } = fakeDb({ nextMessageSeq: 3 });
    await startNewChatSession(prisma, input);
    expect(tx.thread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "thread-1", spaceId: "space-1", botId: "bot-1" },
      }),
    );
  });
});

describe("chatTranscriptTail", () => {
  it("keeps the newest messages that fit, in order", () => {
    const messages = ["a".repeat(30), "b".repeat(30), "c".repeat(30)].map((value, index) => ({
      role: index % 2 === 0 ? "user" : "bot",
      blocks: text(value),
    }));
    const tail = chatTranscriptTail(messages, 80);
    expect(tail.text).toBe(`bot: ${"b".repeat(30)}\n\nuser: ${"c".repeat(30)}`);
    expect(tail.complete).toBe(false);
    expect(chatTranscriptTail(messages, 1_000).complete).toBe(true);
  });
});

describe("loadPreviousChatSessions", () => {
  it("returns the latest archived chats with context, oldest first", async () => {
    const findMany = vi.fn(async () => [
      { title: "newer", summary: "b", createdAt: new Date(2) },
      { title: "older", summary: "a", createdAt: new Date(1) },
    ]);
    const prisma = { chatSession: { findMany } } as unknown as PrismaClient;
    const sessions = await loadPreviousChatSessions(prisma, "thread-1");
    expect(sessions.map((session) => session.title)).toEqual(["older", "newer"]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: "thread-1", summary: { not: null } } }),
    );
  });
});
