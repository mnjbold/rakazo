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
const DEFAULT_VOICE = "af_heart";
const TTS_MODEL = "kokoro";
const DEFAULT_KOKORO_BASE = "https://kokoro.getbijou.xyz/v1";
const STT_MODEL = "sherpa-whisper-tiny";

export function voiceStudioBaseUrl(): string {
  const raw = (process.env.RAKAZO_VOICESTUDIO_BASE_URL ?? DEFAULT_BASE).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_BASE;
}

export function voiceStudioKokoroBaseUrl(): string {
  const raw = (
    process.env.RAKAZO_KOKORO_BASE_URL ?? DEFAULT_KOKORO_BASE
  ).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_KOKORO_BASE;
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

  async listVoices(): Promise<VoiceInfo[]> {
    return [
      {
        id: "af_heart",
        label: "af_heart",
        description: "Fast local Kokoro default",
      },
      {
        id: "am_adam",
        label: "am_adam",
        description: "Fast local Kokoro voice",
      },
    ];
  }

  async synthesize(
    request: VoiceSynthesizeRequest,
    context: AdapterContext,
  ): Promise<SpeechClip> {
    const signal = voiceDeadline(request.signal ?? context.signal, 60_000);
    const res = await fetch(`${voiceStudioKokoroBaseUrl()}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
