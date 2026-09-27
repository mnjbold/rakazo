import type { AdapterContext, MessagingInboundEvent } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { ChatSdkMessagingSurface } from "./chat-sdk-surface.js";
import {
  createEmulatedEvolutionPlatform,
  EVOLUTION_EMULATOR_QR,
  EvolutionEmulator,
} from "./evolution-emulator.js";
import { EVOLUTION_WEBHOOK_SECRET_HEADER } from "./evolution-messaging.js";

const context: AdapterContext = {
  operationId: "op-1",
  traceId: "trace-1",
  spaceId: "ws-1",
  userId: "user-1",
  signal: new AbortController().signal,
};

function createHarness() {
  const emulator = new EvolutionEmulator();
  const surface = new ChatSdkMessagingSurface([createEmulatedEvolutionPlatform(emulator)]);
  const events: MessagingInboundEvent[] = [];
  surface.onInbound(async (event) => {
    events.push(event);
  });
  return { emulator, surface, events };
}

describe("Evolution API line pairing", () => {
  it("creates the instance, registers a secret-bearing webhook, and returns the QR", async () => {
    const { emulator, surface } = createHarness();
    expect(await surface.lines(context)).toEqual([
      { provider: "evolution", state: "disconnected", address: null, qr: null },
    ]);

    const pairing = await surface.pairLine("evolution", context);

    expect(pairing).toEqual({
      provider: "evolution",
      state: "pairing",
      address: null,
      qr: EVOLUTION_EMULATOR_QR,
    });
    expect(emulator.calls).toContain("POST /instance/create");
    expect(emulator.webhook).toEqual({
      enabled: true,
      url: emulator.webhookUrl,
      headers: { [EVOLUTION_WEBHOOK_SECRET_HEADER]: expect.stringMatching(/^[0-9a-f]{64}$/) },
      byEvents: false,
      base64: false,
      events: ["MESSAGES_UPSERT"],
    });
  });

  it("polls pairing → connected with the owner number, then logs out", async () => {
    const { emulator, surface } = createHarness();
    await surface.pairLine("evolution", context);
    expect((await surface.lines(context))[0]).toMatchObject({
      state: "pairing",
      qr: EVOLUTION_EMULATOR_QR,
    });

    emulator.scan();
    expect(await surface.lines(context)).toEqual([
      { provider: "evolution", state: "connected", address: emulator.ownerNumber, qr: null },
    ]);

    await surface.unpairLine("evolution", context);
    expect(emulator.calls).toContain("DELETE /instance/logout/rakazo");
    expect((await surface.lines(context))[0]?.state).toBe("disconnected");
  });

  it("re-pairs an existing instance without recreating it", async () => {
    const { emulator, surface } = createHarness();
    emulator.state = "close";
    await surface.pairLine("evolution", context);
    expect(emulator.calls).not.toContain("POST /instance/create");
    expect(emulator.calls).toContain("POST /webhook/set/rakazo");
  });
});

describe("Evolution API inbound webhook", () => {
  it("rejects a missing or wrong secret before anything reaches the pipeline", async () => {
    const { emulator, surface, events } = createHarness();
    for (const secret of [null, "not-the-secret"]) {
      const response = await surface.handleWebhook(
        "evolution",
        emulator.buildInboundRequest({ fromNumber: "15551234567", text: "hi", secret }),
      );
      expect(response?.status).toBe(401);
    }
    expect(events).toHaveLength(0);
  });

  it("routes a 1:1 text into the inbound pipeline on the direct thread", async () => {
    const { emulator, surface, events } = createHarness();
    await surface.pairLine("evolution", context);
    const response = await surface.handleWebhook(
      "evolution",
      emulator.buildInboundRequest({ fromNumber: "15551234567", text: "hello bot", id: "MSG1" }),
    );

    expect(response?.status).toBe(200);
    expect(events).toEqual([
      {
        type: "message",
        provider: "evolution",
        handle: "MSG1",
        threadId: "evolution:15551234567",
        isDirect: true,
        from: "15551234567",
        fromLabel: "Dana",
        channelName: null,
        participants: [],
        content: "hello bot",
        mediaUrl: null,
      },
    ]);
    expect(await surface.openDirectThread("evolution", "+1 555 123 4567", context)).toBe(
      "evolution:15551234567",
    );
  });

  it("ignores group chats", async () => {
    const { emulator, surface, events } = createHarness();
    const response = await surface.handleWebhook(
      "evolution",
      emulator.buildInboundRequest({
        fromNumber: "15551234567",
        text: "group hi",
        remoteJid: "120363000000000000@g.us",
      }),
    );
    expect(response?.status).toBe(200);
    expect(events).toHaveLength(0);
  });
});

describe("Evolution API outbound", () => {
  it("sends bot replies through message/sendText", async () => {
    const { emulator, surface } = createHarness();
    emulator.scan();
    const threadId = await surface.openDirectThread("evolution", "15551234567", context);
    const result = await surface.sendToThread({ threadId, body: "Reply from the bot" }, context);

    expect(emulator.sent).toEqual([{ number: "15551234567", text: "Reply from the bot" }]);
    expect(emulator.calls).toContain("POST /message/sendText/rakazo");
    expect(result.handle).toMatch(/^EMU\d+$/);
  });
});
