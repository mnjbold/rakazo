import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessagingLinePairing } from "@rakazo/adapter-kit";
import type {
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  FetchResult,
  FormattedContent,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { Message, parseMarkdown, stringifyMarkdown } from "chat";
import type { MessagingPlatform } from "./chat-sdk-surface.js";

/**
 * Evolution API v2 (github.com/EvolutionAPI/evolution-api): a self-hosted
 * WhatsApp Web gateway. The deployment owner pairs one instance by scanning
 * a QR code; inbound arrives as `messages.upsert` webhooks and replies go
 * out through `message/sendText`.
 */
export const EVOLUTION_PROVIDER = "evolution";
/** Header carrying the per-instance secret registered with the webhook. */
export const EVOLUTION_WEBHOOK_SECRET_HEADER = "x-rakazo-webhook-secret";

export interface EvolutionConfig {
  apiUrl: string;
  apiKey: string;
  instance: string;
  /** Public URL Evolution posts to; required to pair (registers the webhook). */
  webhookUrl?: string | undefined;
  fetch?: typeof globalThis.fetch;
}

/** Webhook secret derived from the API key, so api and worker agree without storage. */
export function evolutionWebhookSecret(config: Pick<EvolutionConfig, "apiKey" | "instance">) {
  return createHmac("sha256", config.apiKey)
    .update(`rakazo-evolution-webhook:${config.instance}`)
    .digest("hex");
}

interface EvolutionMessage {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string | null;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
  } | null;
  messageTimestamp?: number | string;
}

type ThreadData = { number: string };

class EvolutionAdapter implements Adapter<ThreadData, EvolutionMessage> {
  readonly name = EVOLUTION_PROVIDER;
  readonly userName = "rakazo";
  private chat: ChatInstance | null = null;
  private readonly secret: string;

  constructor(private readonly config: EvolutionConfig) {
    this.secret = evolutionWebhookSecret(config);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
  }

  encodeThreadId({ number }: ThreadData): string {
    return `${EVOLUTION_PROVIDER}:${number}`;
  }

  decodeThreadId(threadId: string): ThreadData {
    const [provider, number] = threadId.split(":");
    if (provider !== EVOLUTION_PROVIDER || !number) {
      throw new Error(`Invalid Evolution thread ID: ${threadId}`);
    }
    return { number };
  }

  channelIdFromThreadId(threadId: string): string {
    return threadId;
  }

  isDM(): boolean {
    return true;
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const presented = Buffer.from(request.headers.get(EVOLUTION_WEBHOOK_SECRET_HEADER) ?? "");
    const expected = Buffer.from(this.secret);
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      return new Response("Unauthorized", { status: 401 });
    }
    let body: { event?: unknown; instance?: unknown; data?: unknown };
    try {
      body = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    if (body.instance !== this.config.instance || body.event !== "messages.upsert") {
      return new Response("OK", { status: 200 });
    }
    // Evolution sends one message per event; tolerate an array too.
    const messages = (Array.isArray(body.data) ? body.data : [body.data]) as EvolutionMessage[];
    for (const raw of messages) {
      const jid = raw?.key?.remoteJid ?? "";
      // 1:1 chats only: groups (@g.us), status broadcasts, and our own sends are skipped.
      if (!jid.endsWith("@s.whatsapp.net") || raw.key?.fromMe || !raw.key?.id) continue;
      if (!messageText(raw)) continue;
      const threadId = this.encodeThreadId({ number: jidNumber(jid) });
      // Work registers through options.waitUntil; the surface drains it before ACKing.
      void this.chat?.processMessage(this, threadId, this.parseMessage(raw), options);
    }
    return new Response("OK", { status: 200 });
  }

  parseMessage(raw: EvolutionMessage): Message<EvolutionMessage> {
    const number = jidNumber(raw.key?.remoteJid ?? "");
    const text = messageText(raw);
    const seconds = Number(raw.messageTimestamp ?? 0);
    return new Message({
      id: raw.key?.id ?? "",
      threadId: this.encodeThreadId({ number }),
      text,
      formatted: parseMarkdown(text),
      raw,
      author: {
        userId: number,
        userName: number,
        fullName: raw.pushName ?? "",
        isBot: false,
        isMe: Boolean(raw.key?.fromMe),
      },
      metadata: { dateSent: new Date(seconds * 1000), edited: false },
      isMention: true,
      attachments: [],
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<EvolutionMessage>> {
    const { number } = this.decodeThreadId(threadId);
    const text = renderOutbound(message);
    if (!text.trim()) return { raw: {}, id: "", threadId };
    const sent = (await this.call("POST", `/message/sendText/${this.instancePath()}`, {
      number,
      text,
    })) as EvolutionMessage;
    return { raw: sent, id: sent?.key?.id ?? "", threadId };
  }

  renderFormatted(content: FormattedContent): string {
    return stringifyMarkdown(content);
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    return { id: threadId, channelId: threadId, isDM: true, metadata: {} };
  }

  async fetchMessages(): Promise<FetchResult<EvolutionMessage>> {
    return { messages: [] };
  }

  async editMessage(): Promise<RawMessage<EvolutionMessage>> {
    throw new Error("Evolution does not support editing sent messages");
  }

  async deleteMessage(): Promise<void> {}
  async addReaction(): Promise<void> {}
  async removeReaction(): Promise<void> {}
  async startTyping(): Promise<void> {}

  // Line pairing (instance lifecycle), outside the Chat SDK Adapter contract.

  async lineStatus(signal?: AbortSignal): Promise<MessagingLinePairing> {
    const state = await this.connectionState(signal);
    if (state === "open") {
      const [info] = (await this.call(
        "GET",
        `/instance/fetchInstances?instanceName=${this.instancePath()}`,
        undefined,
        signal,
      )) as Array<{ ownerJid?: string | null }>;
      const owner = info?.ownerJid ? jidNumber(info.ownerJid) : null;
      return this.pairing("connected", owner, null);
    }
    if (state === "connecting") return this.pairing("pairing", null, await this.qr(signal));
    return this.pairing("disconnected", null, null);
  }

  async pairLine(signal?: AbortSignal): Promise<MessagingLinePairing> {
    if (!this.config.webhookUrl) throw new Error("Evolution pairing needs a public API URL");
    const state = await this.connectionState(signal);
    if (state === "open") return this.lineStatus(signal);
    if (state === null) {
      await this.call(
        "POST",
        "/instance/create",
        { instanceName: this.config.instance, integration: "WHATSAPP-BAILEYS", qrcode: false },
        signal,
      );
    }
    await this.call(
      "POST",
      `/webhook/set/${this.instancePath()}`,
      {
        webhook: {
          enabled: true,
          url: this.config.webhookUrl,
          headers: { [EVOLUTION_WEBHOOK_SECRET_HEADER]: this.secret },
          byEvents: false,
          base64: false,
          events: ["MESSAGES_UPSERT"],
        },
      },
      signal,
    );
    return this.pairing("pairing", null, await this.qr(signal));
  }

  async unpairLine(signal?: AbortSignal): Promise<void> {
    if ((await this.connectionState(signal)) === "open") {
      await this.call("DELETE", `/instance/logout/${this.instancePath()}`, undefined, signal);
    }
  }

  /** null when the instance does not exist yet. */
  private async connectionState(signal?: AbortSignal): Promise<string | null> {
    const response = await this.request(
      "GET",
      `/instance/connectionState/${this.instancePath()}`,
      undefined,
      signal,
    );
    if (response.status === 404) return null;
    const body = (await readJson(response)) as { instance?: { state?: string } };
    return body.instance?.state ?? "close";
  }

  private async qr(signal?: AbortSignal): Promise<string | null> {
    const body = (await this.call(
      "GET",
      `/instance/connect/${this.instancePath()}`,
      undefined,
      signal,
    )) as { base64?: unknown };
    return typeof body?.base64 === "string" && body.base64.startsWith("data:image/")
      ? body.base64
      : null;
  }

  private pairing(
    state: MessagingLinePairing["state"],
    address: string | null,
    qr: string | null,
  ): MessagingLinePairing {
    return { provider: EVOLUTION_PROVIDER, state, address, qr };
  }

  private instancePath(): string {
    return encodeURIComponent(this.config.instance);
  }

  private async call(method: string, path: string, body?: unknown, signal?: AbortSignal) {
    return readJson(await this.request(method, path, body, signal));
  }

  private request(method: string, path: string, body?: unknown, signal?: AbortSignal) {
    const fetcher = this.config.fetch ?? globalThis.fetch;
    return fetcher(`${this.config.apiUrl.replace(/\/+$/, "")}${path}`, {
      method,
      headers: { apikey: this.config.apiKey, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Evolution API request failed with ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function jidNumber(jid: string): string {
  return jid.split("@", 1)[0]?.split(":", 1)[0] ?? "";
}

function messageText(raw: EvolutionMessage): string {
  const message = raw.message ?? {};
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    ""
  );
}

function renderOutbound(message: AdapterPostableMessage): string {
  if (typeof message === "string") return message;
  if ("markdown" in message && typeof message.markdown === "string") return message.markdown;
  if ("raw" in message && typeof message.raw === "string") return message.raw;
  if ("ast" in message && message.ast) return stringifyMarkdown(message.ast);
  return "";
}

/** The Evolution line as a Chat SDK platform on the shared messaging surface. */
export function createEvolutionPlatform(config: EvolutionConfig): MessagingPlatform {
  const adapter = new EvolutionAdapter(config);
  return {
    provider: EVOLUTION_PROVIDER,
    capabilities: { direct: true, groups: false, typing: false },
    adapter,
    directThreadId: (address) => adapter.encodeThreadId({ number: address.replace(/\D/g, "") }),
    line: {
      status: (signal) => adapter.lineStatus(signal),
      pair: (signal) => adapter.pairLine(signal),
      unpair: (signal) => adapter.unpairLine(signal),
    },
  };
}
