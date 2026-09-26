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

const API = "https://api.minimax.io/v1";
const MODEL = "speech-2.8-turbo";

type MiniMaxBody = {
  base_resp?: { status_code?: number; status_msg?: string };
  data?: { audio?: string };
  system_voice?: Array<{ voice_id?: string; voice_name?: string; description?: unknown }>;
};

export class MiniMaxVoiceProvider implements VoiceProvider {
  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: "minimax",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: true, synthesize: true, transcribe: false },
    };
  }

  async verify(apiKey: string, context: AdapterContext): Promise<VoiceVerifyResult> {
    try {
      await this.systemVoices(apiKey, context, "checking that key");
      return { ok: true };
    } catch (error) {
      if (error instanceof MiniMaxError) return { ok: false, message: error.message };
      return {
        ok: false,
        message: "Couldn't reach MiniMax to check that key — check your connection.",
      };
    }
  }

  async listVoices(apiKey: string, context: AdapterContext): Promise<VoiceInfo[]> {
    const voices = await this.systemVoices(apiKey, context, "listing voices");
    return voices
      .map((voice) => ({
        id: String(voice.voice_id ?? ""),
        label: String(voice.voice_name ?? voice.voice_id ?? "Voice"),
        description: Array.isArray(voice.description)
          ? voice.description.filter((part) => typeof part === "string").join(" ") || undefined
          : undefined,
      }))
      .filter((voice) => voice.id);
  }

  async synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip> {
    const signal = voiceDeadline(request.signal ?? context.signal, 60_000);
    const res = await fetch(`${API}/t2a_v2`, {
      method: "POST",
      headers: { ...minimaxHeaders(request.apiKey), "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        text: request.text,
        stream: false,
        output_format: "hex",
        voice_setting: { voice_id: request.voiceId },
        audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 },
      }),
      signal,
    });
    await requireOk(res, "MiniMax", "speaking");
    // The audio arrives hex-encoded inside JSON, so read it under the audio cap, not the JSON cap.
    const body = parseBody(await readVoiceAudio(res, signal));
    throwOnStatus(body, "speaking");
    const hex = body.data?.audio ?? "";
    if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
      throw new Error("MiniMax returned no audio.");
    }
    return { bytes: Uint8Array.from(Buffer.from(hex, "hex")), mimeType: "audio/mpeg" };
  }

  private async systemVoices(apiKey: string, context: AdapterContext, what: string) {
    const res = await fetch(`${API}/get_voice`, {
      method: "POST",
      headers: { ...minimaxHeaders(apiKey), "content-type": "application/json" },
      body: JSON.stringify({ voice_type: "system" }),
      signal: voiceDeadline(context.signal, 20_000),
    });
    const body = (await readVoiceJson(res, { requireValid: res.ok })) as MiniMaxBody | null;
    if (!res.ok) throw new MiniMaxError(voiceHttpError(res.status, "MiniMax", what, body));
    throwOnStatus(body ?? {}, what);
    return body?.system_voice ?? [];
  }
}

class MiniMaxError extends Error {}

function minimaxHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function parseBody(bytes: Uint8Array): MiniMaxBody {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as MiniMaxBody;
  } catch {
    throw new Error("Voice provider returned invalid JSON.");
  }
}

// MiniMax answers HTTP 200 for API errors and reports them in base_resp.status_code.
function throwOnStatus(body: MiniMaxBody, what: string): void {
  const code = body.base_resp?.status_code ?? 0;
  if (code === 0) return;
  const status = code === 1004 ? 401 : code === 1002 || code === 1039 ? 429 : 400;
  throw new MiniMaxError(
    voiceHttpError(status, "MiniMax", what, { message: body.base_resp?.status_msg }),
  );
}
