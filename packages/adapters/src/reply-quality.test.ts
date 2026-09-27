import type { AgentRunRequest, ReplyJudge } from "@rakazo/adapter-kit";
import { replyJudgeJob } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutor } from "./executor.js";
import { ReplyJudgeEmulator } from "./reply-judge-emulator.js";
import { judgeRunReply, loadReplyQuality } from "./reply-quality.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./computer-lifecycle.js")>()),
  acquireComputerExecutionLease: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

type Row = { runId: string; scores: unknown; feedback: string | null; createdAt: Date };

/** In-memory stand-in for the reply_quality table. */
function qualityTable() {
  const rows: Row[] = [];
  let tick = 0;
  return {
    rows,
    replyQuality: {
      findMany: vi.fn(async ({ take }: { take: number }) =>
        [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
      ),
      upsert: vi.fn(
        async (args: {
          where: { runId: string };
          create: { runId: string; scores?: unknown; feedback?: string | null };
          update: Partial<Row>;
        }) => {
          const existing = rows.find((row) => row.runId === args.where.runId);
          if (existing) Object.assign(existing, args.update);
          else
            rows.push({
              feedback: null,
              scores: null,
              ...args.create,
              createdAt: new Date(++tick * 1000),
            });
        },
      ),
    },
  };
}

function handlerPrisma(
  table: ReturnType<typeof qualityTable>,
  run: { status: string; reply: string | null },
) {
  return {
    ...table,
    run: {
      findUnique: vi.fn(async () => ({
        status: run.status,
        botId: "bot-1",
        spaceId: "space-1",
        threadId: "thread-1",
        sourceMessage: { blocks: [{ kind: "text", text: "How do I reset my password?" }] },
        task: { prompt: "How do I reset my password?" },
        bot: { instructions: "Be helpful" },
      })),
    },
    message: {
      findMany: vi.fn(async () =>
        run.reply === null ? [] : [{ blocks: [{ kind: "text", text: run.reply }] }],
      ),
    },
  } as unknown as PrismaClient;
}

const RAMBLING = `${"First, the OAuth endpoint issues a JSON payload through the API middleware. ".repeat(12)}\n${"- detail\n".repeat(10)}`;

async function runOnce(options: {
  table: ReturnType<typeof qualityTable>;
  trigger?: string;
  live?: boolean;
  reply?: string;
  fail?: boolean;
}) {
  const run = {
    id: "run-next",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: options.trigger ?? "user",
    live: options.live ?? false,
    interruptedHeard: null,
    leaseFence: 0,
  };
  const prisma = {
    replyQuality: options.table.replyQuality,
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(run, data);
        return { count: 1 };
      }),
    },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.botId,
        name: "Assistant",
        title: "Assistant",
        description: "Test assistant",
        computerId: "computer-1",
        computer: { id: "computer-1", scope: "dedicated" },
      })),
      findMany: vi.fn(async () => []),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    thread: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.threadId,
        groupId: null,
        nextMessageSeq: 1,
        historyCompactedUpToSeq: null,
      })),
    },
    message: { findMany: vi.fn(async () => []) },
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "hello" })) },
    connection: { findMany: vi.fn(async () => []) },
    spaceModelPreference: { findFirst: vi.fn(async () => null) },
    userModelCredential: { findFirst: vi.fn(async () => null) },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        defaultModelProvider: "scripted",
        defaultModelId: "scripted",
      })),
    },
    taughtSkill: { findMany: vi.fn(async () => []) },
    agentSecret: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    scratchpadItem: { findMany: vi.fn(async () => []) },
    actionApprovalRule: { findMany: vi.fn(async () => []) },
    actionAutoReviewPreference: { findUnique: vi.fn(async () => null) },
    externalEffect: { findMany: vi.fn(async () => []) },
  };
  const finalizeRun = vi.fn(async () => ({ continuationRunId: null }));
  const enqueue = vi.fn(async () => undefined);
  let request: AgentRunRequest | undefined;
  const runtimeRun = vi.fn(async function* (next: AgentRunRequest) {
    request = next;
    if (options.fail) throw new Error("model exploded");
    yield { type: "done" as const, text: options.reply ?? "Done." };
  });
  const executor = createRunExecutor({
    prisma,
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    connector: { discoverTools: async () => [], resolveCall: async () => undefined },
    sandbox: { describe: () => ({ capabilities: { graphical: false } }) },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    events: { append: vi.fn(async () => undefined), finalizeRun },
    jobs: { enqueue },
    notifications: { notify: vi.fn(async () => undefined) },
    secrets: [],
    judgeReplies: true,
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  await executor.continueRun(run.id, "worker-1");
  const judgeEnqueued = (enqueue.mock.calls as unknown as [{ name: string }][]).some(
    ([job]) => job.name === "reply.judge",
  );
  return { instructions: request?.instructions ?? "", judgeEnqueued, enqueue };
}

describe("judgeRunReply", () => {
  it("stores scores for a completed run's reply", async () => {
    const table = qualityTable();
    const judge = new ReplyJudgeEmulator();
    const spy = vi.spyOn(judge, "judge");
    await judgeRunReply(
      { prisma: handlerPrisma(table, { status: "completed", reply: "Open Settings." }), judge },
      "run-1",
    );
    expect(spy).toHaveBeenCalledWith({
      userRequest: "How do I reset my password?",
      reply: "Open Settings.",
      botInstructions: "Be helpful",
    });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({ runId: "run-1", scores: expect.any(Object) });
  });

  it("skips failed runs, empty and NO_RESPONSE replies, and a missing judge", async () => {
    const table = qualityTable();
    const judge = new ReplyJudgeEmulator();
    const spy = vi.spyOn(judge, "judge");
    for (const run of [
      { status: "failed", reply: "partial" },
      { status: "completed", reply: null },
      { status: "completed", reply: "NO_RESPONSE" },
    ]) {
      await judgeRunReply({ prisma: handlerPrisma(table, run), judge }, "run-1");
    }
    await judgeRunReply(
      { prisma: handlerPrisma(table, { status: "completed", reply: "Hi" }), judge: null },
      "run-1",
    );
    expect(spy).not.toHaveBeenCalled();
    expect(table.rows).toHaveLength(0);
  });

  it("fails open when the judge returns null or throws", async () => {
    const table = qualityTable();
    const prisma = handlerPrisma(table, { status: "completed", reply: "Hi" });
    const nullJudge: ReplyJudge = { judge: async () => null };
    const throwingJudge: ReplyJudge = {
      judge: async () => {
        throw new Error("down");
      },
    };
    await judgeRunReply({ prisma, judge: nullJudge }, "run-1");
    await judgeRunReply({ prisma, judge: throwingJudge }, "run-1");
    expect(table.rows).toHaveLength(0);
  });

  it("keeps earlier thumbs feedback when scores arrive", async () => {
    const table = qualityTable();
    await table.replyQuality.upsert({
      where: { runId: "run-1" },
      create: { runId: "run-1", scores: null, feedback: "down" },
      update: { feedback: "down" },
    });
    await judgeRunReply(
      {
        prisma: handlerPrisma(table, { status: "completed", reply: "Hi" }),
        judge: new ReplyJudgeEmulator(),
      },
      "run-1",
    );
    expect(table.rows[0]).toMatchObject({ feedback: "down", scores: expect.any(Object) });
  });
});

describe("reply.judge enqueue", () => {
  it("enqueues after a people-facing reply only", async () => {
    const table = qualityTable();
    const user = await runOnce({ table, reply: "Here you go." });
    expect(user.enqueue).toHaveBeenCalledWith(replyJudgeJob("run-next"));
    expect((await runOnce({ table, trigger: "routine", reply: "Report" })).judgeEnqueued).toBe(
      false,
    );
    expect((await runOnce({ table, live: true, reply: "NO_RESPONSE" })).judgeEnqueued).toBe(false);
    expect((await runOnce({ table, fail: true })).judgeEnqueued).toBe(false);
  });
});

describe("self-improvement loop", () => {
  it("puts lessons from poorly scored replies into the next run's instructions", async () => {
    const table = qualityTable();
    const before = await runOnce({ table });
    expect(before.instructions).not.toContain("style lessons");

    const judge = new ReplyJudgeEmulator();
    for (const runId of ["run-1", "run-2", "run-3"]) {
      await judgeRunReply(
        { prisma: handlerPrisma(table, { status: "completed", reply: RAMBLING }), judge },
        runId,
      );
    }
    expect(await loadReplyQuality({ replyQuality: table.replyQuality } as never, "bot-1")).toEqual(
      expect.objectContaining({ level: "needs_work" }),
    );

    const after = await runOnce({ table });
    expect(after.instructions).toContain(
      "Your own style lessons from recent reply feedback (the user's request wins):\n- Keep replies shorter: lead with the answer in 1–3 lines, then at most 5 bullets.",
    );
    expect(after.instructions).toContain(
      "- Use plain words; explain any technical term in a few words.",
    );
  });
});
