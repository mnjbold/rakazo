import { readBoundedResponseBytes } from "@rakazo/core";
import { measureReplyLatency } from "./performance.js";
import { rpc, selectedSpaceId, withSpaceHeaders } from "./rpc.js";

export type SpeechStatus = "idle" | "preparing" | "speaking";

export interface SpeechSnapshot {
  status: SpeechStatus;
  botId?: string;
  messageId?: string;
  caption?: string;
  /** While speaking: every utterance of this message spoken so far, including the current one. */
  heard?: string;
  error?: string;
}

interface SpeakOptions {
  voiceId?: string;
  botId?: string;
  messageId?: string;
}

type TtsErrorBody = { error?: string };
type Rendered = { blob: Blob; error?: never } | { blob?: never; error: unknown };

interface SpeechQueue {
  opts: SpeakOptions;
  utterances: string[];
  renders: Promise<Rendered>[];
  playing: number;
  prefetch: () => void;
}

const IDLE: SpeechSnapshot = { status: "idle" };
export const VOICE_RESPONSE_TIMEOUT_MS = 70_000;
export const MAX_VOICE_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_VOICE_ERROR_BYTES = 64 * 1024;

export class Speaker {
  private snapshot: SpeechSnapshot = IDLE;
  private watchers = new Set<(s: SpeechSnapshot) => void>();
  private token = 0;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private settlePlayback: ((finished: boolean) => void) | null = null;
  private request: AbortController | null = null;
  private queue: SpeechQueue | null = null;
  /** Utterances of one message spoken so far, kept across the queues that message spans. */
  private heard: { messageId?: string; utterances: string[] } = { utterances: [] };

  subscribe(fn: (s: SpeechSnapshot) => void): () => void {
    this.watchers.add(fn);
    fn(this.snapshot);
    return () => {
      this.watchers.delete(fn);
    };
  }

  get state(): SpeechSnapshot {
    return this.snapshot;
  }

  private set(next: SpeechSnapshot) {
    this.snapshot = next;
    for (const watcher of [...this.watchers]) watcher(next);
  }

  isSpeaking(messageId?: string): boolean {
    if (this.snapshot.status === "idle") return false;
    return messageId ? this.snapshot.messageId === messageId : true;
  }

  stop() {
    this.token += 1;
    this.request?.abort();
    this.request = null;
    this.queue = null;
    if (this.settlePlayback) this.settlePlayback(false);
    else this.teardownAudio();
    if (this.snapshot.status !== "idle" || this.snapshot.error) this.set(IDLE);
  }

  private teardownAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  async speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    this.stop();
    const mine = this.token;
    const controller = new AbortController();
    this.request = controller;
    const live = () => this.token === mine && !controller.signal.aborted;
    const spaceId = selectedSpaceId();

    this.set({ status: "preparing", botId: opts.botId, messageId: opts.messageId });
    let utterances: string[];
    try {
      utterances = await withAbort(controller.signal, () =>
        this.prepare(text, opts, controller.signal, spaceId),
      );
    } catch (error) {
      if (live()) {
        this.set({ ...IDLE, error: error instanceof Error ? error.message : String(error) });
      }
      if (this.request === controller) this.request = null;
      return;
    }
    if (!live()) return;
    this.heard = { messageId: opts.messageId, utterances: [] };
    await this.drain(this.startQueue(utterances, opts, controller, spaceId), live, controller);
  }

  /**
   * Speak utterances as they become ready, such as the sentences of a streaming reply. More
   * utterances for the message already speaking join its queue, and `heard` keeps growing across
   * them; anything else replaces what is playing.
   */
  enqueue(utterances: string[], opts: SpeakOptions = {}): void {
    if (!utterances.length) return;
    const current = this.queue;
    if (current && opts.messageId && current.opts.messageId === opts.messageId) {
      current.utterances.push(...utterances);
      current.prefetch();
      return;
    }
    this.stop();
    if (!opts.messageId || this.heard.messageId !== opts.messageId) {
      this.heard = { messageId: opts.messageId, utterances: [] };
    }
    const mine = this.token;
    const controller = new AbortController();
    this.request = controller;
    const live = () => this.token === mine && !controller.signal.aborted;
    this.set({ status: "preparing", botId: opts.botId, messageId: opts.messageId });
    const queue = this.startQueue([...utterances], opts, controller, selectedSpaceId());
    void this.drain(queue, live, controller);
  }

  private startQueue(
    utterances: string[],
    opts: SpeakOptions,
    controller: AbortController,
    spaceId: string | null,
  ): SpeechQueue {
    const queue: SpeechQueue = {
      opts,
      utterances,
      renders: [],
      playing: 0,
      // Audio for the playing utterance and the next one only, so the next starts without a gap
      // and a long reply does not flood the voice provider.
      prefetch: () => {
        const last = Math.min(queue.playing + 1, queue.utterances.length - 1);
        for (let i = queue.playing; i <= last; i += 1) {
          queue.renders[i] ??= this.render(
            queue.utterances[i] ?? "",
            opts,
            controller.signal,
            spaceId,
          ).then(
            (blob) => ({ blob }),
            (error: unknown) => ({ error }),
          );
        }
      },
    };
    this.queue = queue;
    return queue;
  }

  private async drain(queue: SpeechQueue, live: () => boolean, controller: AbortController) {
    const finish = (next: SpeechSnapshot | null) => {
      if (next && live()) this.set(next);
      if (this.request === controller) this.request = null;
      if (this.queue === queue) this.queue = null;
    };
    // Utterances appended while one plays are picked up here, so the length is read every turn.
    for (let i = 0; i < queue.utterances.length; i += 1) {
      queue.playing = i;
      queue.prefetch();
      const rendered = await queue.renders[i];
      if (!rendered || "error" in rendered) {
        const error = rendered?.error;
        finish({ ...IDLE, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (!live()) return finish(null);
      this.heard.utterances.push(queue.utterances[i] ?? "");
      this.set({
        status: "speaking",
        botId: queue.opts.botId,
        messageId: queue.opts.messageId,
        caption: queue.utterances[i],
        heard: this.heard.utterances.join(" "),
      });
      measureReplyLatency();
      const finished = await this.play(rendered.blob, live);
      if (!finished || !live()) return finish(IDLE);
    }
    finish(IDLE);
  }

  private async prepare(
    text: string,
    opts: SpeakOptions,
    signal: AbortSignal,
    spaceId: string | null,
  ): Promise<string[]> {
    const body = await rpc.voice.prepare(
      { text, voiceId: opts.voiceId, botId: opts.botId },
      { signal, context: { spaceId } },
    );
    if (!body.ready) {
      throw new Error("Add a voice provider key and pick a voice in Voice settings.");
    }
    return body.utterances ?? [];
  }

  private async render(
    text: string,
    opts: SpeakOptions,
    signal: AbortSignal,
    spaceId: string | null,
  ): Promise<Blob> {
    const deadline = requestDeadline(signal, VOICE_RESPONSE_TIMEOUT_MS);
    try {
      const res = await withAbort(deadline.signal, () =>
        fetch("/api/voice/speak", {
          method: "POST",
          headers: withSpaceHeaders({ "content-type": "application/json" }, spaceId),
          credentials: "include",
          body: JSON.stringify({ text, voiceId: opts.voiceId, botId: opts.botId }),
          signal: deadline.signal,
        }),
      );
      if (!res.ok) {
        const body = await readVoiceError(res, deadline.signal);
        throw new Error(body.error ?? `the voice service returned ${res.status}`);
      }
      const bytes = await readResponseBytes(res, MAX_VOICE_AUDIO_BYTES, deadline.signal);
      return new Blob([new Uint8Array(bytes)], {
        type: res.headers.get("content-type") ?? "audio/mpeg",
      });
    } finally {
      deadline.dispose();
    }
  }

  private play(blob: Blob, live: () => boolean): Promise<boolean> {
    return new Promise((resolve) => {
      if (!live()) return resolve(false);
      this.teardownAudio();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.audio = audio;
      this.objectUrl = url;
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        if (this.settlePlayback === done) this.settlePlayback = null;
        if (this.audio === audio) this.teardownAudio();
        resolve(ok);
      };
      this.settlePlayback = done;
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.play().catch(() => done(false));
    });
  }
}

export const speaker = new Speaker();

function withAbort<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    run().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function requestDeadline(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) abortFromParent();
  else parent.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Voice request timed out.")),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abortFromParent);
    },
  };
}

async function readVoiceError(response: Response, signal: AbortSignal): Promise<TtsErrorBody> {
  const bytes = await readResponseBytes(response, MAX_VOICE_ERROR_BYTES, signal);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as TtsErrorBody) : {};
  } catch {
    return {};
  }
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancelResponse(response);
    throw new Error("Voice response is too large.");
  }
  return readBoundedResponseBytes(response, {
    maxBytes,
    tooLargeMessage: "Voice response is too large.",
    read: (operation) => withAbort(signal, operation),
  });
}

function cancelResponse(response: Response): void {
  try {
    void Promise.resolve(response.body?.cancel()).catch(() => undefined);
  } catch {
    // Response cleanup is best-effort.
  }
}
