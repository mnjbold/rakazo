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

const API = "https://api.telnyx.com/v2";
const STT_MODEL = "openai/whisper-large-v3-turbo";

// Telnyx voices are "Provider.Model.Voice" ids; these are the ones its TTS docs name.
const TELNYX_VOICES: VoiceInfo[] = [
  { id: "Telnyx.KokoroTTS.af", label: "Kokoro", description: "Low latency" },
  { id: "Telnyx.Ultra.Clara", label: "Ultra Clara", description: "Expressive, 40+ languages" },
  {
    id: "Minimax.speech-2.6-turbo.English_expressive_narrator",
    label: "MiniMax Narrator",
    description: "Expressive",
  },
  { id: "Polly.Amy-Neural", label: "Polly Amy", description: "British English" },
  { id: "Inworld.Mini.Loretta", label: "Inworld Loretta", description: "Conversational" },
];

export class TelnyxVoiceProvider implements VoiceProvider {
  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: "telnyx",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: true, synthesize: true, transcribe: true },
    };
  }

  async verify(apiKey: string, context: AdapterContext): Promise<VoiceVerifyResult> {
    try {
      const res = await fetch(`${API}/balance`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: voiceDeadline(context.signal, 20_000),
      });
      if (res.ok) return { ok: true };
      return {
        ok: false,
        message: voiceHttpError(
          res.status,
          "Telnyx",
          "checking that key",
          await readVoiceJson(res),
        ),
      };
    } catch {
      return {
        ok: false,
        message: "Couldn't reach Telnyx to check that key — check your connection.",
      };
    }
  }

  async listVoices(_apiKey: string, _context: AdapterContext): Promise<VoiceInfo[]> {
    return TELNYX_VOICES;
  }

  async synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip> {
    const signal = voiceDeadline(request.signal ?? context.signal, 60_000);
    const res = await fetch(`${API}/text-to-speech/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: request.text,
        voice: request.voiceId,
        output_type: "binary_output",
      }),
      signal,
    });
    await requireOk(res, "Telnyx", "speaking");
    const type = res.headers?.get("content-type") ?? "";
    const mimeType = type.includes("wav")
      ? "audio/wav"
      : type.includes("ogg")
        ? "audio/ogg"
        : "audio/mpeg";
    return { bytes: await readVoiceAudio(res, signal), mimeType };
  }

  async transcribe(
    request: VoiceTranscribeRequest,
    context: AdapterContext,
  ): Promise<{ text: string }> {
    const form = new FormData();
    form.set("model", STT_MODEL);
    form.set(
      "file",
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType || "audio/webm" }),
      speechUploadName(request.mimeType),
    );
    const res = await fetch(`${API}/ai/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${request.apiKey}` },
      body: form,
      signal: voiceDeadline(request.signal ?? context.signal, 60_000),
    });
    const body = await readVoiceJson(res, { requireValid: res.ok });
    if (!res.ok) throw new Error(voiceHttpError(res.status, "Telnyx", "transcribing", body));
    return { text: String((body as { text?: unknown } | null)?.text ?? "").trim() };
  }
}
