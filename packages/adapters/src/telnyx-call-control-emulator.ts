import type { KeyObject } from "node:crypto";
import { generateKeyPairSync, sign } from "node:crypto";

export interface EmulatedCallCommand {
  callId: string;
  action: string;
  body: Record<string, unknown>;
}

/**
 * Offline Telnyx Call Control boundary: serves `/v2/calls/:id/actions/:action`
 * over an injected fetch, records every command, and builds Ed25519-signed
 * webhooks with its own key pair, exactly as Telnyx signs them.
 */
export class TelnyxCallControlEmulator {
  readonly commands: EmulatedCallCommand[] = [];
  readonly publicKey: string;
  private readonly privateKey: KeyObject;
  private eventCounter = 0;

  constructor(private readonly now: () => number = Date.now) {
    const pair = generateKeyPairSync("ed25519");
    this.privateKey = pair.privateKey;
    const jwk = pair.publicKey.export({ format: "jwk" });
    this.publicKey = Buffer.from(String(jwk.x), "base64url").toString("base64");
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const match = /^\/v2\/calls\/([^/]+)\/actions\/([a-z_]+)$/.exec(url.pathname);
    if (url.hostname !== "api.telnyx.com" || !match || init?.method !== "POST") {
      throw new Error(`Telnyx emulator received unexpected request ${url}`);
    }
    if (!new Headers(init.headers).get("authorization")?.startsWith("Bearer ")) {
      return Response.json({ errors: [{ title: "Unauthorized" }] }, { status: 401 });
    }
    this.commands.push({
      callId: decodeURIComponent(match[1] ?? ""),
      action: match[2] ?? "",
      body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
    });
    return Response.json({ data: { result: "ok" } });
  };

  actions(callId?: string): string[] {
    return this.commands.filter((c) => !callId || c.callId === callId).map((c) => c.action);
  }

  /** A signed webhook request as Telnyx would POST it. */
  webhook(
    url: string,
    eventType: string,
    payload: Record<string, unknown>,
    options: { timestamp?: number; tamper?: boolean } = {},
  ): Request {
    this.eventCounter += 1;
    const body = JSON.stringify({
      data: {
        record_type: "event",
        id: `evt-${this.eventCounter}`,
        event_type: eventType,
        occurred_at: new Date(this.now()).toISOString(),
        payload,
      },
    });
    const timestamp = String(options.timestamp ?? Math.floor(this.now() / 1000));
    const signature = sign(null, Buffer.from(`${timestamp}|${body}`), this.privateKey);
    return new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": signature.toString("base64"),
        "telnyx-timestamp": timestamp,
      },
      body: options.tamper ? body.replace(eventType, `${eventType} `) : body,
    });
  }
}
