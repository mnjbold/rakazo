import type { MessagingPlatform } from "./chat-sdk-surface.js";
import {
  createEvolutionPlatform,
  EVOLUTION_WEBHOOK_SECRET_HEADER,
  evolutionWebhookSecret,
} from "./evolution-messaging.js";

/** A 1x1 PNG, standing in for the QR image Evolution renders. */
export const EVOLUTION_EMULATOR_QR =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * Deterministic Evolution API v2 boundary: serves the instance, webhook, and
 * sendText routes over an injected fetch and builds webhook requests exactly
 * as Evolution posts them. `scan()` stands in for the phone scanning the QR.
 */
export class EvolutionEmulator {
  readonly apiUrl = "https://evolution.test";
  readonly apiKey = "emulated-evolution-key";
  readonly instance = "rakazo";
  readonly ownerNumber = "15550007777";
  readonly webhookUrl = "https://rakazo.test/api/v1/messaging/webhook/evolution";
  readonly sent: Array<{ number: string; text: string }> = [];
  readonly calls: string[] = [];
  webhook: { url?: string; headers?: Record<string, string>; events?: string[] } | null = null;
  state: "absent" | "close" | "connecting" | "open" = "absent";
  private counter = 0;

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== this.apiUrl) throw new Error(`Evolution emulator got unexpected URL ${url}`);
    const method = init?.method?.toUpperCase() ?? "GET";
    const headers = new Headers(init?.headers);
    this.calls.push(`${method} ${url.pathname}`);
    if (headers.get("apikey") !== this.apiKey) {
      return Response.json({ status: 401, error: "Unauthorized" }, { status: 401 });
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const route = `${method} ${url.pathname.replace(`/${this.instance}`, "/:instance")}`;
    if (route === "POST /instance/create") {
      if (this.state !== "absent") return Response.json({ status: 403 }, { status: 403 });
      this.state = "close";
      return Response.json(
        { instance: { instanceName: body.instanceName, status: "close" }, hash: "emulated-hash" },
        { status: 201 },
      );
    }
    if (this.state === "absent") {
      return Response.json({ status: 404, error: "Not Found" }, { status: 404 });
    }
    switch (route) {
      case "GET /instance/connectionState/:instance":
        return Response.json({ instance: { instanceName: this.instance, state: this.state } });
      case "GET /instance/connect/:instance":
        if (this.state === "open") {
          return Response.json({ instance: { instanceName: this.instance, state: "open" } });
        }
        this.state = "connecting";
        return Response.json({
          pairingCode: null,
          code: "2@emulated",
          base64: EVOLUTION_EMULATOR_QR,
          count: 1,
        });
      case "GET /instance/fetchInstances":
        return Response.json([
          {
            name: this.instance,
            connectionStatus: this.state,
            ownerJid: this.state === "open" ? `${this.ownerNumber}@s.whatsapp.net` : null,
          },
        ]);
      case "POST /webhook/set/:instance":
        this.webhook = body.webhook;
        return Response.json({ enabled: true, ...body.webhook }, { status: 201 });
      case "DELETE /instance/logout/:instance":
        this.state = "close";
        return Response.json({
          status: "SUCCESS",
          error: false,
          response: { message: "Instance logged out" },
        });
      case "POST /message/sendText/:instance": {
        this.sent.push({ number: String(body.number), text: String(body.text) });
        this.counter += 1;
        return Response.json(
          {
            key: {
              remoteJid: `${body.number}@s.whatsapp.net`,
              fromMe: true,
              id: `EMU${this.counter}`,
            },
            message: { conversation: body.text },
            messageTimestamp: 1_767_225_600,
            status: "PENDING",
          },
          { status: 201 },
        );
      }
    }
    throw new Error(`Evolution emulator got unexpected request ${method} ${url.pathname}`);
  };

  /** The phone scanned the QR: the instance is now logged in. */
  scan(): void {
    this.state = "open";
  }

  /** A messages.upsert webhook as Evolution posts it, signed with the registered header. */
  buildInboundRequest(input: {
    fromNumber: string;
    text: string;
    id?: string;
    secret?: string | null;
    remoteJid?: string;
  }): Request {
    const secret =
      input.secret === undefined
        ? (this.webhook?.headers?.[EVOLUTION_WEBHOOK_SECRET_HEADER] ?? evolutionWebhookSecret(this))
        : input.secret;
    this.counter += 1;
    return new Request(this.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { [EVOLUTION_WEBHOOK_SECRET_HEADER]: secret } : {}),
      },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: this.instance,
        data: {
          key: {
            remoteJid: input.remoteJid ?? `${input.fromNumber}@s.whatsapp.net`,
            fromMe: false,
            id: input.id ?? `IN${this.counter}`,
          },
          pushName: "Dana",
          message: { conversation: input.text },
          messageType: "conversation",
          messageTimestamp: 1_767_225_600,
        },
        destination: this.webhookUrl,
        date_time: "2026-01-01T00:00:00.000Z",
        sender: `${this.ownerNumber}@s.whatsapp.net`,
        server_url: this.apiUrl,
        apikey: "instance-token",
      }),
    });
  }
}

/** The production Evolution platform wired to the emulator's HTTP boundary. */
export function createEmulatedEvolutionPlatform(emulator: EvolutionEmulator): MessagingPlatform {
  return createEvolutionPlatform({
    apiUrl: emulator.apiUrl,
    apiKey: emulator.apiKey,
    instance: emulator.instance,
    webhookUrl: emulator.webhookUrl,
    fetch: emulator.fetch,
  });
}
