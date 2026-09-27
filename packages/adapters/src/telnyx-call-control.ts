import type { KeyObject } from "node:crypto";
import { createPublicKey, verify } from "node:crypto";
import type { PhoneCallEvent, PhoneCallProvider } from "@rakazo/adapter-kit";

const API = "https://api.telnyx.com/v2";
/** Telnyx's documented replay window for signed webhooks. */
const MAX_SKEW_SECONDS = 5 * 60;
const DEFAULT_VOICE = "Telnyx.KokoroTTS.af";

export interface TelnyxCallControlOptions {
  apiKey: string;
  /** Base64 Ed25519 public key from the Telnyx portal (Keys & Credentials → Public Key). */
  publicKey: string;
  voice?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * Telnyx Call Control v2, turn-based: `speak` for replies and
 * `transcription_start` (inbound track only, so the bot never hears itself)
 * for the caller's final transcripts.
 */
export class TelnyxCallControl implements PhoneCallProvider {
  private readonly key: KeyObject;
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor(private readonly options: TelnyxCallControlOptions) {
    this.key = telnyxPublicKey(options.publicKey);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async parseWebhook(
    request: Request,
  ): Promise<{ ok: false } | { ok: true; event: PhoneCallEvent | null }> {
    const signature = request.headers.get("telnyx-signature-ed25519");
    const timestamp = request.headers.get("telnyx-timestamp");
    if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return { ok: false };
    if (Math.abs(this.now() / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false };
    const raw = await request.text();
    const valid = verify(
      null,
      Buffer.from(`${timestamp}|${raw}`),
      this.key,
      Buffer.from(signature, "base64"),
    );
    if (!valid) return { ok: false };
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { ok: true, event: null };
    }
    return { ok: true, event: translate(body) };
  }

  answer(callId: string) {
    return this.command(callId, "answer", {});
  }

  speak(callId: string, text: string) {
    // Telnyx caps a speak payload at 3,000 characters.
    return this.command(callId, "speak", {
      payload: text.slice(0, 3000),
      voice: this.options.voice ?? DEFAULT_VOICE,
    });
  }

  listen(callId: string) {
    return this.command(callId, "transcription_start", {
      transcription_engine: "Telnyx",
      transcription_tracks: "inbound",
    });
  }

  hangup(callId: string) {
    return this.command(callId, "hangup", {});
  }

  private async command(callId: string, action: string, body: Record<string, unknown>) {
    const res = await this.fetch(`${API}/calls/${encodeURIComponent(callId)}/actions/${action}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Telnyx ${action} failed with HTTP ${res.status}`);
  }
}

function telnyxPublicKey(base64: string): KeyObject {
  const raw = Buffer.from(base64, "base64");
  if (raw.length !== 32) throw new Error("TELNYX_PUBLIC_KEY must be a base64 Ed25519 public key");
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
    format: "jwk",
  });
}

function translate(body: unknown): PhoneCallEvent | null {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  const payload = data?.payload as Record<string, unknown> | undefined;
  const eventId = typeof data?.id === "string" ? data.id : "";
  const callId = typeof payload?.call_control_id === "string" ? payload.call_control_id : "";
  if (!eventId || !callId) return null;
  switch (data?.event_type) {
    case "call.initiated":
      // Outbound legs also fire call.initiated; only callers reaching the number count.
      if (payload?.direction !== "incoming") return null;
      return {
        kind: "incoming",
        eventId,
        callId,
        from: String(payload.from ?? ""),
        to: String(payload.to ?? ""),
      };
    case "call.answered":
      return { kind: "answered", eventId, callId };
    case "call.speak.ended":
      return { kind: "spoken", eventId, callId };
    case "call.hangup":
      return { kind: "ended", eventId, callId };
    case "call.transcription": {
      const t = payload?.transcription_data as
        | { is_final?: unknown; transcript?: unknown }
        | undefined;
      const text = typeof t?.transcript === "string" ? t.transcript.trim() : "";
      if (t?.is_final !== true || !text) return null;
      return { kind: "speech", eventId, callId, text };
    }
    default:
      return null;
  }
}
