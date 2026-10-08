import type { AgentRunRequest } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutor } from "./executor.js";
import { NO_RESPONSE } from "./silent-reply.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./computer-lifecycle.js")>()),
  acquireComputerExecutionLease: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

const ALERT = "Acme sent invoice #42, due Friday.";

/** Stand-in model: reports the inbox item unless the watch says it was already reported. */
function inboxModel(request: AgentRunRequest): string {
  return request.prompt.includes("Already reported") && request.prompt.includes("invoice #42")
    ? NO_RESPONSE
    : ALERT;
}

/** Routine runs share one message log so each run sees what earlier runs posted. */
function createWatchWorld({ watch, inboxEmpty }: { watch: boolean; inboxEmpty?: boolean }) {
  const posted: Array<{ runId: string; blocks: MessageBlock[] }> = [];
  const notify = vi.fn(async () => undefined);
  const requests: AgentRunRequest[] = [];

  async function runOnce(runId: string) {
    const run = {
      id: runId,
      botId: "bot-1",
      threadId: "thread-1",
      taskId: `task-${runId}`,
      spaceId: "space-1",
      userId: "user-1",
      status: "queued",
      trigger: "routine",
      routineId: "routine-1",
      live: false,
      leaseFence: 0,
    };
    const prisma = {
      run: {
        findUnique: vi.fn(async () => run),
        findUniqueOrThrow: vi.fn(async () => run),
        findFirst: vi.fn(async () => ({
          bot: { notifyOnFinish: true },
          thread: { groupId: null },
        })),
        findMany: vi.fn(async () =>
          [...new Set(posted.map((row) => row.runId))].reverse().map((id) => ({ id })),
        ),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(run, data);
          return { count: 1 };
        }),
      },
      routine: { findUnique: vi.fn(async () => ({ watch })) },
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
      message: {
        findMany: vi.fn(async (args?: { where?: { runId?: { in?: string[] } } }) => {
          const ids = args?.where?.runId?.in;
          if (!ids) return [];
          return posted.filter((row) => ids.includes(row.runId)).map(({ blocks }) => ({ blocks }));
        }),
      },
      task: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: run.taskId,
          prompt: "Check Gmail for important email. If there is nothing, stay silent.",
        })),
      },
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
      botSecret: { findMany: vi.fn(async () => []) },
      agentSkill: { findMany: vi.fn(async () => []) },
      scratchpadItem: { findMany: vi.fn(async () => []) },
      actionApprovalRule: { findMany: vi.fn(async () => []) },
      actionAutoReviewPreference: { findUnique: vi.fn(async () => null) },
      externalEffect: { findMany: vi.fn(async () => []) },
    };
    const finalizeRun = vi.fn(async (input: { runId: string; blocks: MessageBlock[] }) => {
      if (input.blocks.length > 0) posted.push({ runId: input.runId, blocks: input.blocks });
      return { continuationRunId: null };
    });
    const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
      requests.push(request);
      yield { type: "done" as const, text: inboxEmpty ? NO_RESPONSE : inboxModel(request) };
    });
    const executor = createRunExecutor({
      prisma,
      runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
      connector: { discoverTools: async () => [], resolveCall: async () => undefined },
      sandbox: { describe: () => ({ capabilities: { graphical: false } }) },
      memory: { read: async () => ({ documents: [] }) },
      memoryProviders: { resolve: async () => null },
      events: { append: vi.fn(async () => undefined), finalizeRun },
      jobs: { enqueue: vi.fn(async () => undefined) },
      notifications: { send: notify },
      secrets: [],
    } as unknown as Parameters<typeof createRunExecutor>[0]);
    await executor.continueRun(run.id, "worker-1");
    expect(runtimeRun).toHaveBeenCalledOnce();
    return finalizeRun;
  }

  return { runOnce, posted, notify, requests };
}

describe("watch routines", () => {
  it("finish silently with no message or push when nothing is new", async () => {
    const world = createWatchWorld({ watch: true, inboxEmpty: true });
    const finalizeRun = await world.runOnce("run-1");
    expect(finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "completed", blocks: [] }),
    );
    expect(world.posted).toHaveLength(0);
    expect(world.notify).not.toHaveBeenCalled();
    expect(world.requests[0]?.prompt).toContain("Only report or ask");
  });

  it("post a new item once and stay silent on the next run", async () => {
    const world = createWatchWorld({ watch: true });
    await world.runOnce("run-1");
    await world.runOnce("run-2");
    expect(world.posted).toEqual([
      { runId: "run-1", blocks: [expect.objectContaining({ kind: "text", text: ALERT })] },
    ]);
    expect(world.notify).toHaveBeenCalledOnce();
    expect(world.requests[1]?.prompt).toContain(`- ${ALERT}`);
  });

  it("leave ordinary routines without watch context", async () => {
    const world = createWatchWorld({ watch: false });
    await world.runOnce("run-1");
    await world.runOnce("run-2");
    expect(world.posted).toHaveLength(2);
    expect(world.requests[1]?.prompt).not.toContain("Already reported");
  });
});
