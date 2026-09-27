import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { AgentRunModel, AgentRuntime } from "@rakazo/adapter-kit";
import { modelAcceptsImageInput } from "@rakazo/adapters";
import type { Actor, BotImageDraft, BotImageDraftInput } from "@rakazo/contracts";
import { BOT_IMAGE_DRAFT_MAX_BYTES } from "@rakazo/contracts";
import {
  BOT_IMAGE_DRAFT_INSTRUCTIONS,
  BOT_IMAGE_DRAFT_PROMPT,
  parseBotImageDraft,
  sniffImageMimeType,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

export const BOT_IMAGE_DRAFT_CANNOT_SEE_MESSAGE =
  "This space's model can't read images. Pick a vision-capable model or fill in the bot yourself.";
const DRAFT_TIMEOUT_MS = 60_000;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 10;

export interface BotImageDrafterDeps {
  prisma: PrismaClient;
  runtime: AgentRuntime;
  resolveModel: (scope: { userId: string; spaceId: string }) => Promise<AgentRunModel>;
  now?: () => number;
}

export type BotImageDrafter = (
  actor: Actor,
  input: BotImageDraftInput,
  signal?: AbortSignal,
) => Promise<BotImageDraft>;

/**
 * One model call that reads the image and returns a validated draft. The image
 * lives only in this request; nothing is written except the usage record.
 */
export function createBotImageDrafter(deps: BotImageDrafterDeps): BotImageDrafter {
  const now = deps.now ?? Date.now;
  // ponytail: per-process window; move to Postgres if the API runs as several replicas.
  const recent = new Map<string, number[]>();

  return async (actor, input, signal) => {
    const at = now();
    const calls = (recent.get(actor.userId) ?? []).filter((time) => at - time < WINDOW_MS);
    if (calls.length >= MAX_PER_WINDOW) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Too many image drafts. Try again in a few minutes.",
      });
    }
    calls.push(at);
    recent.set(actor.userId, calls);

    const data = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
    if (data.byteLength === 0 || data.byteLength > BOT_IMAGE_DRAFT_MAX_BYTES) {
      throw new ORPCError("PAYLOAD_TOO_LARGE", { message: "Image must be 5 MB or smaller." });
    }
    if (sniffImageMimeType(data) !== input.mimeType) {
      throw new ORPCError("BAD_REQUEST", { message: "Use a PNG, JPEG, WebP, or GIF image." });
    }

    let model: AgentRunModel;
    try {
      model = await deps.resolveModel({ userId: actor.userId, spaceId: actor.spaceId });
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Connect a model first.",
      });
    }
    const scripted = deps.runtime.describe().capabilities.scripted === true;
    if (!scripted && !modelAcceptsImageInput(model.provider, model.id, model.acceptsImages)) {
      throw new ORPCError("UNPROCESSABLE_CONTENT", {
        message: BOT_IMAGE_DRAFT_CANNOT_SEE_MESSAGE,
      });
    }

    const runId = `bot-image-draft:${randomUUID()}`;
    const timeout = AbortSignal.timeout(DRAFT_TIMEOUT_MS);
    let text = "";
    for await (const event of deps.runtime.run(
      {
        botId: runId,
        threadId: runId,
        runId,
        prompt: BOT_IMAGE_DRAFT_PROMPT,
        instructions: BOT_IMAGE_DRAFT_INSTRUCTIONS,
        history: [],
        currentTurnImages: [{ name: "image", mimeType: input.mimeType, data }],
        tools: [],
        model,
      },
      {
        operationId: runId,
        traceId: runId,
        spaceId: actor.spaceId,
        userId: actor.userId,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    )) {
      if (event.type === "done" && event.text) text = event.text;
      if (event.type === "usage") {
        await deps.prisma.usageRecord.create({
          data: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            provider: event.provider,
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cacheReadTokens: event.cacheReadTokens,
            cacheWriteTokens: event.cacheWriteTokens,
          },
        });
      }
    }
    const draft = parseBotImageDraft(text);
    if (!draft) {
      throw new ORPCError("BAD_GATEWAY", {
        message: "Couldn't draft a bot from that image. Fill it in yourself or try another.",
      });
    }
    return draft;
  };
}
