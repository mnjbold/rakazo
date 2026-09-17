import type {
  AdapterContext,
  AdapterDescriptor,
  SpeechClip,
  VoiceCapabilities,
  VoiceInfo,
  VoiceProvider,
  VoiceSynthesizeRequest,
  VoiceTranscribeRequest,
  VoiceVerifyResult,
} from "@rakazo/adapter-kit";
import {
  readVoiceAudio,
  readVoiceJson,
  requireOk,
  speechUploadName,
  voiceDeadline,
  voiceHttpError,
} from "./voice-http.js";

const DEFAULT_BASE = "http://voicestudio:3900/v1";
const DEFAULT_VOICE = "expr-voice-2-f";
const TTS_MODEL = "kittentts";
const STT_MODEL = "sherpa-whisper-tiny";

export function voiceStudioBaseUrl(): string {
  const raw = (process.env.RAKAZO_VOICESTUDIO_BASE_URL ?? DEFAULT_BASE).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_BASE;
}

function headers(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey.trim()}` };
}

export class VoiceStudioVoiceProvider implements VoiceProvider {
  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: "voicestudio",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: true, synthesize: true, transcribe: true },
    };
  }

  async verify(
    apiKey: string,
    context: AdapterContext,
  ): Promise<VoiceVerifyResult> {
    try {
      const base = voiceStudioBaseUrl().replace(/\/v1$/, "");
      const res = await fetch(`${base}/v1/audio/capabilities`, {
        headers: headers(apiKey),
        signal: voiceDeadline(context.signal, 20_000),
      });
      if (res.ok) return { ok: true };
      return {
        ok: false,
        message: voiceHttpError(
          res.status,
          "VoiceStudio",
          "checking that endpoint",
          await readVoiceJson(res),
        ),
      };
    } catch {
      return {
        ok: false,
        message: "Couldn't reach VoiceStudio to check that endpoint.",
      };
    }
  }

  async listVoices(
    apiKey: string,
    context: AdapterContext,
  ): Promise<VoiceInfo[]> {
    const res = await fetch(`${voiceStudioBaseUrl()}/audio/voices`, {
      headers: headers(apiKey),
      signal: voiceDeadline(context.signal, 20_000),
    });
    const body = await readVoiceJson(res, { requireValid: res.ok });
    if (!res.ok)
      throw new Error(
        voiceHttpError(res.status, "VoiceStudio", "listing voices", body),
      );
    const rows = Array.isArray(body)
      ? body
      : body &&
          typeof body === "object" &&
          Array.isArray((body as { data?: unknown }).data)
        ? (body as { data: unknown[] }).data
        : body &&
            typeof body === "object" &&
            Array.isArray((body as { voices?: unknown }).voices)
          ? (body as { voices: unknown[] }).voices
          : [];
    const voices = rows
      .filter((row): row is Record<string, unknown> =>
        Boolean(row && typeof row === "object"),
      )
      .map((row) => ({
        id: String(row.id ?? row.voice_id ?? row.name ?? ""),
        label: String(row.name ?? row.label ?? row.id ?? "Voice"),
        description:
          typeof row.description === "string" ? row.description : undefined,
      }))
      .filter((voice) => voice.id);
    if (voices.length) return voices;
    return [
      {
        id: DEFAULT_VOICE,
        label: DEFAULT_VOICE,
        description: "KittenTTS English default",
      },
    ];
  }

  async synthesize(
    request: VoiceSynthesizeRequest,
    context: AdapterContext,
  ): Promise<SpeechClip> {
    const signal = voiceDeadline(request.signal ?? context.signal, 60_000);
    const res = await fetch(`${voiceStudioBaseUrl()}/audio/speech`, {
      method: "POST",
      headers: {
        ...headers(request.apiKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: request.voiceId?.trim() || DEFAULT_VOICE,
        input: request.text,
        response_format: "mp3",
      }),
      signal,
    });
    await requireOk(res, "VoiceStudio", "speaking");
    return { bytes: await readVoiceAudio(res, signal), mimeType: "audio/mpeg" };
  }

  async transcribe(
    request: VoiceTranscribeRequest,
    context: AdapterContext,
  ): Promise<{ text: string }> {
    const form = new FormData();
    form.set("model", STT_MODEL);
    form.set(
      "file",
      new Blob([new Uint8Array(request.audio)], {
        type: request.mimeType || "audio/webm",
      }),
      speechUploadName(request.mimeType),
    );
    const res = await fetch(`${voiceStudioBaseUrl()}/audio/transcriptions`, {
      method: "POST",
      headers: headers(request.apiKey),
      body: form,
      signal: voiceDeadline(request.signal ?? context.signal, 60_000),
    });
    const body = await readVoiceJson(res, { requireValid: res.ok });
    if (!res.ok)
      throw new Error(
        voiceHttpError(res.status, "VoiceStudio", "transcribing", body),
      );
    return {
      text: String((body as { text?: unknown } | null)?.text ?? "").trim(),
    };
  }
}
