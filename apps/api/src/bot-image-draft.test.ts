import type { AgentRunRequest, AgentRuntime } from "@rakazo/adapter-kit";
import { ScriptedAgentRuntime } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { BOT_IMAGE_DRAFT_CANNOT_SEE_MESSAGE, createBotImageDrafter } from "./bot-image-draft.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "a@rakazo.test",
  isDeploymentOwner: false,
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString(
  "base64",
);
const prisma = { usageRecord: { create: vi.fn(async () => ({})) } } as unknown as PrismaClient;

function textOnlyRuntime(): AgentRuntime & { requests: AgentRunRequest[] } {
  const requests: AgentRunRequest[] = [];
  return {
    requests,
    describe: () => ({
      id: "pi",
      contractVersion: "1",
      adapterVersion: "test",
      capabilities: { streaming: true, compaction: false, tools: true },
    }),
    abort: async () => undefined,
    async *run(request) {
      requests.push(request);
      yield { type: "done", text: "{}" };
    },
  };
}

describe("createBotImageDrafter", () => {
  it("returns a validated draft and sends the image to the model once", async () => {
    const runtime = new ScriptedAgentRuntime();
    const run = vi.spyOn(runtime, "run");
    const draft = createBotImageDrafter({
      prisma,
      runtime,
      resolveModel: async () => ({ provider: "scripted", id: "scripted" }),
    });
    const result = await draft(actor, { mimeType: "image/png", contentBase64: PNG });
    expect(result).toMatchObject({
      name: "Harbor Scout",
      title: "Tracks ships in port",
      color: "#06B6D4::shape_7",
      routines: [{ name: "Arrivals", cron: "0 * * * *" }],
    });
    expect(run.mock.calls[0]?.[0].currentTurnImages?.[0]?.mimeType).toBe("image/png");
    expect(run.mock.calls[0]?.[0].tools).toEqual([]);
  });

  it("refuses a model that cannot see images without calling it", async () => {
    const runtime = textOnlyRuntime();
    const draft = createBotImageDrafter({
      prisma,
      runtime,
      resolveModel: async () => ({
        provider: "openai-compatible",
        id: "text-only",
        acceptsImages: false,
      }),
    });
    await expect(draft(actor, { mimeType: "image/png", contentBase64: PNG })).rejects.toMatchObject(
      { code: "UNPROCESSABLE_CONTENT", message: BOT_IMAGE_DRAFT_CANNOT_SEE_MESSAGE },
    );
    expect(runtime.requests).toHaveLength(0);
  });

  it("rejects bytes that do not match the declared image type", async () => {
    const draft = createBotImageDrafter({
      prisma,
      runtime: new ScriptedAgentRuntime(),
      resolveModel: async () => ({ provider: "scripted", id: "scripted" }),
    });
    const svg = Buffer.from("<svg></svg>").toString("base64");
    await expect(draft(actor, { mimeType: "image/png", contentBase64: svg })).rejects.toMatchObject(
      {
        code: "BAD_REQUEST",
      },
    );
  });

  it("limits drafts per user", async () => {
    const draft = createBotImageDrafter({
      prisma,
      runtime: new ScriptedAgentRuntime(),
      resolveModel: async () => ({ provider: "scripted", id: "scripted" }),
      now: () => 1_000,
    });
    for (let index = 0; index < 10; index += 1) {
      await draft(actor, { mimeType: "image/png", contentBase64: PNG });
    }
    await expect(draft(actor, { mimeType: "image/png", contentBase64: PNG })).rejects.toMatchObject(
      {
        code: "TOO_MANY_REQUESTS",
      },
    );
  });

  it("reports unusable model output instead of an empty draft", async () => {
    const draft = createBotImageDrafter({
      prisma,
      runtime: textOnlyRuntime(),
      resolveModel: async () => ({
        provider: "openai-compatible",
        id: "vision",
        acceptsImages: true,
      }),
    });
    await expect(draft(actor, { mimeType: "image/png", contentBase64: PNG })).rejects.toMatchObject(
      {
        code: "BAD_GATEWAY",
      },
    );
  });
});
