import { runContinueJob } from "@rakazo/adapter-kit";
import { TelnyxCallControl, TelnyxCallControlEmulator } from "@rakazo/adapters";
import type { ProductEvent } from "@rakazo/contracts";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPhoneCallRoute, normalizePhoneNumber, PHONE_WEBHOOK_PATH } from "./phone-call.js";

const OWNER = "+15551230000";
const URL = `http://localhost${PHONE_WEBHOOK_PATH}`;

function setup(options: { reply?: string; follow?: "complete" | "hold"; pin?: string } = {}) {
  const emulator = new TelnyxCallControlEmulator();
  const followSignals: AbortSignal[] = [];
  const prisma = {
    bot: {
      findFirst: vi.fn(async () => ({
        id: "bot-1",
        spaceId: "space-1",
        userId: "user-1",
        name: "Jewl",
        thread: { id: "thread-1" },
      })),
    },
    event: { findFirst: vi.fn(async () => ({ seq: 41 })) },
    message: {
      findFirst: vi.fn(async () => ({
        id: "msg-bot-1",
        blocks: [{ kind: "text", text: options.reply ?? "Sure, it's done." }],
      })),
    },
  };
  const events = {
    sendUserMessage: vi.fn(async () => ({
      messageId: "msg-1",
      seq: 1,
      taskId: "task-1",
      runId: "run-1",
    })),
    follow: vi.fn(async function* (
      _threadId: string,
      _cursor: number,
      signal?: AbortSignal,
    ): AsyncGenerator<ProductEvent> {
      if (signal) followSignals.push(signal);
      if (options.follow === "hold") {
        await new Promise((resolve) => signal?.addEventListener("abort", resolve));
        return;
      }
      yield {
        id: "evt-run",
        spaceId: "space-1",
        threadId: "thread-1",
        botId: "bot-1",
        seq: 42,
        type: "run.completed",
        runId: "run-1",
        createdAt: new Date().toISOString(),
        payload: {},
      };
    }),
  };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const app = new Hono();
  mountPhoneCallRoute(app, {
    phone: new TelnyxCallControl({
      apiKey: "KEY_test",
      publicKey: emulator.publicKey,
      fetch: emulator.fetch,
    }),
    prisma: prisma as never,
    events,
    jobs,
    botId: "bot-1",
    allowedCallers: [OWNER],
    pin: options.pin,
  });
  const send = (type: string, payload: Record<string, unknown>) =>
    app.request(emulator.webhook(URL, type, { call_control_id: "call-1", ...payload }));
  return { app, emulator, events, jobs, followSignals, send };
}

async function ring(send: ReturnType<typeof setup>["send"], from: string) {
  expect((await send("call.initiated", { direction: "incoming", from, to: "+1555" })).status).toBe(
    200,
  );
  expect((await send("call.answered", {})).status).toBe(200);
}

function speech(send: ReturnType<typeof setup>["send"], transcript: string) {
  return send("call.transcription", { transcription_data: { is_final: true, transcript } });
}

describe("Telnyx phone calls", () => {
  it("answers an allowed caller, greets, listens, runs live, and speaks the reply", async () => {
    const { emulator, events, jobs, send } = setup();
    await ring(send, "+1 (555) 123-0000");
    expect(emulator.actions()).toEqual(["answer", "speak", "transcription_start"]);
    expect(emulator.commands[1]?.body.payload).toBe("Hi, it's Jewl.");

    expect((await speech(send, "book the flight")).status).toBe(200);
    expect(events.sendUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        botId: "bot-1",
        userId: "user-1",
        prompt: "book the flight",
        live: true,
        clientNonce: expect.stringMatching(/^phone:evt-/),
      }),
    );
    expect(jobs.enqueue).toHaveBeenCalledWith(runContinueJob("run-1"));
    expect(events.follow).toHaveBeenCalledWith("thread-1", 41, expect.any(AbortSignal));
    await vi.waitFor(() => expect(emulator.actions()).toHaveLength(4));
    expect(emulator.commands[3]).toMatchObject({
      action: "speak",
      body: { payload: "Sure, it's done." },
    });
  });

  it("stays silent when the live run replies NO_RESPONSE", async () => {
    const { emulator, events, send } = setup({ reply: " NO_RESPONSE " });
    await ring(send, OWNER);
    await speech(send, "talking to someone else");
    await vi.waitFor(() => expect(events.follow).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emulator.actions()).toEqual(["answer", "speak", "transcription_start"]);
  });

  it("politely declines an unknown caller and never reaches the bot", async () => {
    const { emulator, events, send } = setup();
    await ring(send, "+15550000000");
    expect(emulator.actions()).toEqual(["answer", "speak"]);
    expect(emulator.commands[1]?.body.payload).toBe("Sorry, this number can't take your call.");
    await speech(send, "let me in");
    expect(events.sendUserMessage).not.toHaveBeenCalled();
    await send("call.speak.ended", {});
    expect(emulator.actions()).toEqual(["answer", "speak", "hangup"]);
  });

  it("rejects unsigned or forged webhooks without touching the call", async () => {
    const { app, emulator } = setup();
    const forged = new TelnyxCallControlEmulator().webhook(URL, "call.initiated", {
      call_control_id: "call-1",
      direction: "incoming",
      from: OWNER,
    });
    expect((await app.request(forged)).status).toBe(401);
    const stale = emulator.webhook(
      URL,
      "call.initiated",
      { call_control_id: "call-1", direction: "incoming", from: OWNER },
      { timestamp: Math.floor(Date.now() / 1000) - 600 },
    );
    expect((await app.request(stale)).status).toBe(401);
    expect(emulator.commands).toEqual([]);
  });

  it("cleans up on hangup: stops the reply watcher and ignores later speech", async () => {
    const { events, followSignals, send } = setup({ follow: "hold" });
    await ring(send, OWNER);
    await speech(send, "hello");
    await vi.waitFor(() => expect(followSignals).toHaveLength(1));
    expect(followSignals[0]?.aborted).toBe(false);
    await send("call.hangup", {});
    expect(followSignals[0]?.aborted).toBe(true);
    await speech(send, "still there?");
    expect(events.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("hangs up an answered call it has no state for", async () => {
    const { emulator, send } = setup();
    await send("call.answered", {});
    expect(emulator.actions()).toEqual(["hangup"]);
  });

  describe("with a caller PIN", () => {
    const PIN = "4821";
    const keypad = (send: ReturnType<typeof setup>["send"], digits: string, status = "valid") =>
      send("call.gather.ended", { digits, status });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("asks for the PIN, ignores speech until it is entered, then starts the speech flow", async () => {
      const { emulator, events, send } = setup({ pin: PIN });
      await ring(send, OWNER);
      expect(emulator.actions()).toEqual(["answer", "speak", "gather"]);
      expect(emulator.commands[1]?.body.payload).toBe("Enter your PIN.");

      await speech(send, "book the flight");
      expect(events.sendUserMessage).not.toHaveBeenCalled();

      await keypad(send, PIN);
      expect(emulator.actions()).toEqual([
        "answer",
        "speak",
        "gather",
        "speak",
        "transcription_start",
      ]);
      expect(emulator.commands[3]?.body.payload).toBe("Hi, it's Jewl.");
      await speech(send, "book the flight");
      expect(events.sendUserMessage).toHaveBeenCalledTimes(1);
    });

    it("hangs up after three wrong PINs without creating any message or run", async () => {
      const { emulator, events, jobs, send } = setup({ pin: PIN });
      await ring(send, OWNER);
      await keypad(send, "0000");
      await keypad(send, "", "timeout");
      await keypad(send, "48219");
      expect(emulator.commands.at(-1)?.body.payload).toBe("Wrong PIN. Goodbye.");
      await speech(send, "let me in");
      await send("call.speak.ended", {});
      expect(emulator.actions()).toEqual([
        "answer",
        "speak",
        "gather",
        "speak",
        "gather",
        "speak",
        "gather",
        "speak",
        "hangup",
      ]);
      expect(emulator.actions()).not.toContain("transcription_start");
      expect(events.sendUserMessage).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it("counts a retried gather webhook once", async () => {
      const { app, emulator, send } = setup({ pin: PIN });
      await ring(send, OWNER);
      const wrong = emulator.webhook(URL, "call.gather.ended", {
        call_control_id: "call-1",
        digits: "0000",
        status: "valid",
      });
      await app.request(wrong.clone());
      await app.request(wrong.clone());
      await app.request(wrong);
      await keypad(send, PIN);
      expect(emulator.actions()).toContain("transcription_start");
    });

    it("locks a number out after five failures in fifteen minutes, across calls", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { emulator, send } = setup({ pin: PIN });
      await ring(send, OWNER);
      for (let i = 0; i < 3; i += 1) await keypad(send, "0000");
      await send("call.hangup", {});
      await ring(send, OWNER);
      await keypad(send, "0000");
      await keypad(send, "0000");
      expect(emulator.commands.at(-1)?.body.payload).toBe("Wrong PIN. Goodbye.");
      await send("call.hangup", {});

      emulator.commands.length = 0;
      await ring(send, OWNER);
      expect(emulator.actions()).toEqual(["answer", "speak"]);
      expect(emulator.commands[1]?.body.payload).toBe("Sorry, this number can't take your call.");
      await keypad(send, PIN);
      expect(emulator.actions()).toEqual(["answer", "speak"]);
      await send("call.hangup", {});

      vi.setSystemTime(Date.now() + 15 * 60_000 + 1);
      emulator.commands.length = 0;
      await ring(send, OWNER);
      await keypad(send, PIN);
      expect(emulator.actions()).toContain("transcription_start");
    });
  });

  it("normalizes phone numbers to digits", () => {
    expect(normalizePhoneNumber("+1-202-555-0133")).toBe(normalizePhoneNumber("+12025550133"));
  });
});
