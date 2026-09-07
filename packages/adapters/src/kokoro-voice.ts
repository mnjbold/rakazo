import type {
  AdapterContext,
  AdapterDescriptor,
  SpeechClip,
  VoiceCapabilities,
  VoiceInfo,
  VoiceProvider,
  VoiceSynthesizeRequest,
  VoiceVerifyResult,
} from "@rakazo/adapter-kit";
import {
  readVoiceAudio,
  readVoiceJson,
  requireOk,
  voiceDeadline,
  voiceHttpError,
} from "./voice-http.js";

/** Default OpenAI-compatible base (includes /v1). Override with RAKAZO_KOKORO_BASE_URL. */
const DEFAULT_BASE = "https://kokoro.getbijou.xyz/v1";
const TTS_MODEL = "kokoro";
const FALLBACK_VOICES: VoiceInfo[] = [
  { id: "af_heart", label: "af_heart", description: "Default Kokoro voice" },
];

export function kokoroBaseUrl(): string {
  const raw = (process.env.RAKAZO_KOKORO_BASE_URL ?? DEFAULT_BASE).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_BASE;
}

function kokoroHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  // Kokoro typically needs no auth; still send Bearer when a placeholder/key is stored.
  if (!key) return {};
  return { authorization: `Bearer ${key}` };
}

export class KokoroVoiceProvider implements VoiceProvider {
  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: "kokoro",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: true, synthesize: true, transcribe: false },
    };
  }

  async verify(apiKey: string, context: AdapterContext): Promise<VoiceVerifyResult> {
    const base = kokoroBaseUrl();
    try {
      // Prefer /models (OpenAI-compatible); fall back to host /health when base ends with /v1.
      const modelsUrl = `${base}/models`;
      const res = await fetch(modelsUrl, {
        headers: kokoroHeaders(apiKey),
        signal: voiceDeadline(context.signal, 20_000),
      });
      if (res.ok) return { ok: true };

      const healthBase = base.replace(/\/v1$/, "");
      if (healthBase !== base) {
        const health = await fetch(`${healthBase}/health`, {
          signal: voiceDeadline(context.signal, 10_000),
        });
        if (health.ok) return { ok: true };
      }

      return {
        ok: false,
        message: voiceHttpError(
          res.status,
          "Kokoro",
          "checking that endpoint",
          await readVoiceJson(res),
        ),
      };
    } catch {
      return {
        ok: false,
        message: "Couldn't reach Kokoro to check that endpoint — check your connection.",
      };
    }
  }

  async listVoices(apiKey: string, context: AdapterContext): Promise<VoiceInfo[]> {
    const base = kokoroBaseUrl();
    try {
      const res = await fetch(`${base}/audio/voices`, {
        headers: kokoroHeaders(apiKey),
        signal: voiceDeadline(context.signal, 20_000),
      });
      const body = await readVoiceJson(res, { requireValid: res.ok });
      if (!res.ok) throw new Error(voiceHttpError(res.status, "Kokoro", "listing voices", body));
      const voices = voicesFrom(body)
        .map((voice) => ({
          id: String(voice.id ?? voice.name ?? ""),
          label: String(voice.name ?? voice.id ?? "Voice"),
          description:
            typeof voice.overall_grade === "string"
              ? `Grade ${voice.overall_grade}`
              : typeof voice.description === "string"
                ? voice.description
                : undefined,
        }))
        .filter((voice) => voice.id);
      if (voices.length) {
        // Prefer af_heart near the top when present.
        voices.sort((a, b) => {
          if (a.id === "af_heart") return -1;
          if (b.id === "af_heart") return 1;
          return a.label.localeCompare(b.label);
        });
        return voices;
      }
    } catch {
      // Fall through to static default so connect still works offline/misconfigured.
    }
    return FALLBACK_VOICES;
  }

  async synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip> {
    const base = kokoroBaseUrl();
    const signal = voiceDeadline(request.signal ?? context.signal, 60_000);
    const voice = request.voiceId?.trim() || "af_heart";
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: {
        ...kokoroHeaders(request.apiKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice,
        input: request.text,
        response_format: "mp3",
      }),
      signal,
    });
    await requireOk(res, "Kokoro", "speaking");
    return { bytes: await readVoiceAudio(res, signal), mimeType: "audio/mpeg" };
  }
}

function voicesFrom(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.voices)) return record.voices as Array<Record<string, unknown>>;
    if (Array.isArray(record.data)) return record.data as Array<Record<string, unknown>>;
  }
  return [];
}
