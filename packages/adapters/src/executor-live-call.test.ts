import type { AgentRunRequest } from "@rakazo/adapter-kit";
import {
  LIVE_CALL_INSTRUCTION,
  liveInterruptionInstruction,
  SILENT_REPLY_TOKEN,
} from "@rakazo/core";
import { describe, expect, it, vi } from "vitest";
import { createRunExecutor } from "./executor.js";
import { NO_RESPONSE } from "./silent-reply.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./computer-lifecycle.js")>()),
  acquireComputerExecutionLease: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

async function runOnce({
  live,
  reply,
  interruptedHeard = null,
}: {
  live: boolean;
  reply: string;
  interruptedHeard?: string | null;
}) {
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: "user",
    live,
    interruptedHeard,
    leaseFence: 0,
  };
  const prisma = {
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
  let request: AgentRunRequest | undefined;
  const runtimeRun = vi.fn(async function* (next: AgentRunRequest) {
    request = next;
    yield { type: "done" as const, text: reply };
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
    notifications: { notify: vi.fn(async () => undefined) },
    secrets: [],
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  await executor.continueRun(run.id, "worker-1");
  expect(runtimeRun).toHaveBeenCalledOnce();
  return { request: request!, finalizeRun };
}

describe("live call runs", () => {
  it("adds the live-call instruction only for live runs", async () => {
    const live = await runOnce({ live: true, reply: "Sure." });
    const chat = await runOnce({ live: false, reply: "Sure." });
    expect(live.request.instructions).toContain(LIVE_CALL_INSTRUCTION);
    expect(chat.request.instructions).not.toContain(LIVE_CALL_INSTRUCTION);
    expect(live.request.allowSilentEmpty).toBe(true);
  });

  it("tells the model what was heard only for an interrupted live run", async () => {
    const heard = "Your flight leaves at nine.";
    const guidance = liveInterruptionInstruction(true, heard)!;
    const interrupted = await runOnce({ live: true, reply: "Sure.", interruptedHeard: heard });
    const plain = await runOnce({ live: true, reply: "Sure." });
    const notLive = await runOnce({ live: false, reply: "Sure.", interruptedHeard: heard });
    expect(interrupted.request.instructions).toContain(guidance);
    expect(plain.request.instructions).not.toContain("interrupted your previous reply");
    expect(notLive.request.instructions).not.toContain("interrupted your previous reply");
  });

  it("does not persist a silent reply as a chat bubble", async () => {
    const { finalizeRun } = await runOnce({ live: true, reply: SILENT_REPLY_TOKEN });
    expect(finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "completed", blocks: [] }),
    );
    const chat = await runOnce({ live: false, reply: SILENT_REPLY_TOKEN });
    expect(chat.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: [{ kind: "text", text: SILENT_REPLY_TOKEN }] }),
    );
  });

  it("shares the exact silent token with routines and keeps any reply with extra words", async () => {
    expect(SILENT_REPLY_TOKEN).toBe(NO_RESPONSE);
    const spoken = await runOnce({ live: true, reply: `${NO_RESPONSE}, but the meeting moved.` });
    expect(spoken.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: [{ kind: "text", text: `${NO_RESPONSE}, but the meeting moved.` }],
      }),
    );
  });
});
