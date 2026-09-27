import { createHash, timingSafeEqual } from "node:crypto";
import type { JobPublisher, PhoneCallEvent, PhoneCallProvider } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import type { MessageBlock } from "@rakazo/contracts";
import { isSilentReply } from "@rakazo/core";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";

export const PHONE_WEBHOOK_PATH = "/api/v1/phone/telnyx/webhook";

/** A bot turn on the phone waits at most this long before the watcher gives up. */
const MAX_WEBHOOK_BYTES = 64 * 1024;
const TURN_TIMEOUT_MS = 10 * 60_000;
const REPLY_EVENTS = new Set(["run.waiting_input", "run.completed", "run.failed", "run.cancelled"]);
const RUN_DONE = new Set(["run.completed", "run.failed", "run.cancelled"]);
const PIN_MAX_DIGITS = 12;
const PIN_ATTEMPTS_PER_CALL = 3;
const LOCKOUT_FAILURES = 5;
const LOCKOUT_WINDOW_MS = 15 * 60_000;

export interface PhoneCallDeps {
  phone: PhoneCallProvider;
  prisma: PrismaClient;
  events: Pick<ThreadEvents, "sendUserMessage" | "follow">;
  jobs: Pick<JobPublisher, "enqueue">;
  /** The bot every allowed caller talks to; its owner's 1:1 thread carries the call. */
  botId: string;
  /** Caller numbers that reach the bot. Everyone else is politely declined. */
  allowedCallers: string[];
  /** When set, an allowed caller must key this PIN before anything reaches the bot. */
  pin?: string;
}

interface Target {
  spaceId: string;
  userId: string;
  botId: string;
  threadId: string;
  name: string;
}

interface ActiveCall {
  /** Null once the call is declined; the next `spoken` event hangs up. */
  target: Target | null;
  from: string;
  /** Caller ID can be spoofed, so a configured PIN gates every utterance. */
  verified: boolean;
  pinAttempts: number;
  /** Telnyx retries webhooks; a retried gather result must not count twice. */
  gathers: Set<string>;
  abort: AbortController;
  watching: Set<string>;
  spoken: Set<string>;
}

/** Digits only, so "+1 (202) 555-0133" and "+12025550133" match. */
export function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, "");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Turn-based phone calls into live runs. Allowed callers are answered and
 * greeted; each final transcript becomes a live run on the bot owner's
 * thread, and the run's reply is spoken back unless it chose silence.
 */
export function createPhoneCallHandler(deps: PhoneCallDeps) {
  // ponytail: per-process call state; a multi-replica API needs sticky routing or shared state.
  const calls = new Map<string, ActiveCall>();
  const allowed = new Set(deps.allowedCallers.map(normalizePhoneNumber).filter(Boolean));
  const pinDigest = deps.pin ? digest(deps.pin) : null;
  // ponytail: per-process PIN lockout, keyed only by allow-listed numbers so it stays small;
  // a multi-replica API needs shared state for the limit to hold across replicas.
  const pinFailures = new Map<string, number[]>();

  function recentFailures(from: string): number[] {
    const cutoff = Date.now() - LOCKOUT_WINDOW_MS;
    const recent = (pinFailures.get(from) ?? []).filter((at) => at > cutoff);
    if (recent.length) pinFailures.set(from, recent);
    else pinFailures.delete(from);
    return recent;
  }

  async function resolveTarget(): Promise<Target | null> {
    const bot = await deps.prisma.bot.findFirst({
      where: { id: deps.botId, archivedAt: null },
      select: {
        id: true,
        spaceId: true,
        userId: true,
        name: true,
        thread: { select: { id: true } },
      },
    });
    if (!bot?.thread) return null;
    return {
      spaceId: bot.spaceId,
      userId: bot.userId,
      botId: bot.id,
      threadId: bot.thread.id,
      name: bot.name,
    };
  }

  async function speakReply(callId: string, call: ActiveCall, runId: string) {
    const message = await deps.prisma.message.findFirst({
      where: { threadId: call.target?.threadId, runId, role: "bot" },
      orderBy: { seq: "desc" },
      select: { id: true, blocks: true },
    });
    if (!message || call.spoken.has(message.id)) return;
    call.spoken.add(message.id);
    const text = ((message.blocks ?? []) as MessageBlock[])
      .flatMap((block) => (block.kind === "text" ? [block.text] : []))
      .join(" ")
      .trim();
    if (!text || isSilentReply(text) || call.abort.signal.aborted) return;
    await deps.phone.speak(callId, text);
  }

  async function watchRun(callId: string, call: ActiveCall, runId: string, cursor: number) {
    const target = call.target;
    if (!target) return;
    const signal = AbortSignal.any([call.abort.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);
    try {
      for await (const event of deps.events.follow(target.threadId, cursor, signal)) {
        if (event.runId !== runId || !REPLY_EVENTS.has(event.type)) continue;
        await speakReply(callId, call, runId);
        if (RUN_DONE.has(event.type)) break;
      }
    } catch (error) {
      if (!signal.aborted) getLogger().error("phone call reply watcher failed", error);
    } finally {
      call.watching.delete(runId);
    }
  }

  async function onSpeech(event: Extract<PhoneCallEvent, { kind: "speech" }>) {
    const call = calls.get(event.callId);
    const target = call?.target;
    if (!call || !target || !call.verified) return;
    const last = await deps.prisma.event.findFirst({
      where: { threadId: target.threadId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const sent = await deps.events.sendUserMessage({
      spaceId: target.spaceId,
      threadId: target.threadId,
      botId: target.botId,
      userId: target.userId,
      blocks: [{ kind: "text", text: event.text }],
      prompt: event.text,
      trigger: "user",
      // Telnyx retries webhooks; the event id makes a retried utterance a replay.
      clientNonce: `phone:${event.eventId}`,
      live: true,
    });
    if (sent.taskId && sent.runId) await deps.jobs.enqueue(runContinueJob(sent.runId));
    // A mid-run utterance steers the active run; one watcher per run speaks its reply once.
    if (sent.runId && !call.watching.has(sent.runId)) {
      call.watching.add(sent.runId);
      void watchRun(event.callId, call, sent.runId, last?.seq ?? 0);
    }
  }

  // The entered digits are never logged.
  async function onDigits(event: Extract<PhoneCallEvent, { kind: "digits" }>) {
    const call = calls.get(event.callId);
    if (!call?.target || call.verified || !pinDigest || call.gathers.has(event.eventId)) return;
    call.gathers.add(event.eventId);
    // Hash both sides so the comparison is constant-time regardless of entry length.
    if (timingSafeEqual(digest(event.digits.replace(/#$/, "")), pinDigest)) {
      call.verified = true;
      pinFailures.delete(call.from);
      await deps.phone.speak(event.callId, `Hi, it's ${call.target.name}.`);
      await deps.phone.listen(event.callId);
      return;
    }
    call.pinAttempts += 1;
    const recent = recentFailures(call.from);
    pinFailures.set(call.from, [...recent, Date.now()]);
    if (call.pinAttempts >= PIN_ATTEMPTS_PER_CALL || recent.length + 1 >= LOCKOUT_FAILURES) {
      call.target = null;
      await deps.phone.speak(event.callId, "Wrong PIN. Goodbye.");
      return;
    }
    await deps.phone.speak(event.callId, "Wrong PIN. Try again.");
    await deps.phone.gatherDigits(event.callId, PIN_MAX_DIGITS);
  }

  return async (event: PhoneCallEvent): Promise<void> => {
    switch (event.kind) {
      case "incoming": {
        const from = normalizePhoneNumber(event.from);
        const lockedOut = pinDigest !== null && recentFailures(from).length >= LOCKOUT_FAILURES;
        const target = allowed.has(from) && !lockedOut ? await resolveTarget() : null;
        calls.set(event.callId, {
          target,
          from,
          verified: pinDigest === null,
          pinAttempts: 0,
          gathers: new Set(),
          abort: new AbortController(),
          watching: new Set(),
          spoken: new Set(),
        });
        await deps.phone.answer(event.callId);
        return;
      }
      case "answered": {
        const call = calls.get(event.callId);
        if (!call) {
          // State lost (e.g. an API restart mid-call): end rather than leave a silent line.
          await deps.phone.hangup(event.callId);
          return;
        }
        if (!call.target) {
          await deps.phone.speak(event.callId, "Sorry, this number can't take your call.");
          return;
        }
        if (!call.verified) {
          await deps.phone.speak(event.callId, "Enter your PIN.");
          await deps.phone.gatherDigits(event.callId, PIN_MAX_DIGITS);
          return;
        }
        await deps.phone.speak(event.callId, `Hi, it's ${call.target.name}.`);
        await deps.phone.listen(event.callId);
        return;
      }
      case "spoken": {
        const call = calls.get(event.callId);
        if (call && !call.target) await deps.phone.hangup(event.callId);
        return;
      }
      case "speech":
        await onSpeech(event);
        return;
      case "digits":
        await onDigits(event);
        return;
      case "ended": {
        calls.get(event.callId)?.abort.abort();
        calls.delete(event.callId);
        return;
      }
    }
  };
}

export function mountPhoneCallRoute(app: Hono, deps: PhoneCallDeps) {
  const handle = createPhoneCallHandler(deps);
  app.post(PHONE_WEBHOOK_PATH, async (c) => {
    // Bound the body before verification so unsigned requests cannot make us buffer much.
    const raw = await readBoundedBody(c.req.raw, MAX_WEBHOOK_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    const parsed = await deps.phone.parseWebhook(
      new Request(c.req.url, { method: "POST", headers: c.req.raw.headers, body: raw }),
    );
    if (!parsed.ok) return c.json({ error: "Unauthorized" }, 401);
    if (parsed.event) await handle(parsed.event);
    return c.json({ ok: true });
  });
}
