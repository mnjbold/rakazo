import type { VoiceProvider } from "@rakazo/adapter-kit";
import { CartesiaVoiceProvider } from "./cartesia-voice.js";
import { ElevenLabsVoiceProvider } from "./elevenlabs-voice.js";
import { FishAudioVoiceProvider } from "./fish-audio-voice.js";
import { KokoroVoiceProvider } from "./kokoro-voice.js";
import { MiniMaxVoiceProvider } from "./minimax-voice.js";
import { OpenAIVoiceProvider } from "./openai-voice.js";
import { SCRIPTED_VOICE_CATALOG_ENTRY, ScriptedVoiceProvider } from "./scripted-voice.js";
import { TelnyxVoiceProvider } from "./telnyx-voice.js";
import { VoiceStudioVoiceProvider } from "./voicestudio-voice.js";

export const VOICE_CATALOG = [
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Highest quality and cloning. Flash v2.5 for conversational calls.",
    transcribe: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Simple TTS plus Whisper-class transcription. Reuse an OpenAI key.",
    transcribe: true,
  },
  {
    id: "cartesia",
    name: "Cartesia",
    description: "Lowest-latency Sonic voices for interruptible calls.",
    transcribe: false,
  },
  {
    id: "voicestudio",
    name: "VoiceStudio (Bijou)",
    description: "Private local speech with KittenTTS and multilingual transcription.",
    transcribe: true,
    managed: true,
  },
  {
    id: "kokoro",
    name: "Kokoro (Bijou)",
    description: "Local OpenAI-compatible TTS. No cloud key required — use a placeholder.",
    transcribe: false,
    managed: false,
  },
  {
    id: "fish-audio",
    name: "Fish Audio",
    description: "Voice models, cloning, and expressive speech with optional transcription.",
    transcribe: true,
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "Expressive Speech voices. Pre-configured on server.",
    transcribe: false,
    managed: true,
  },
  {
    id: "telnyx",
    name: "Telnyx",
    description:
      "Kokoro, Ultra, MiniMax voices plus Whisper transcription. Pre-configured on server.",
    transcribe: true,
    managed: true,
  },
] as const;

export { SCRIPTED_VOICE_CATALOG_ENTRY };

export type HostedVoiceProviderId = (typeof VOICE_CATALOG)[number]["id"];
export type VoiceProviderId = HostedVoiceProviderId | "scripted";

export function scriptedVoiceEnabled() {
  return process.env.AGENT_RUNTIME === "scripted";
}

export function listVoiceCatalog() {
  return scriptedVoiceEnabled()
    ? [...VOICE_CATALOG, SCRIPTED_VOICE_CATALOG_ENTRY]
    : [...VOICE_CATALOG];
}

export function voiceCatalogEntry(id: string) {
  if (id === SCRIPTED_VOICE_CATALOG_ENTRY.id) return SCRIPTED_VOICE_CATALOG_ENTRY;
  return VOICE_CATALOG.find((entry) => entry.id === id);
}

export function isVoiceProviderId(value: string): value is VoiceProviderId {
  if (value === "scripted") return scriptedVoiceEnabled();
  return VOICE_CATALOG.some((entry) => entry.id === value);
}

/** Construct the provider adapter selected by a persisted voice credential. */
export function createVoiceProvider(kind: string): VoiceProvider {
  switch (kind) {
    case "elevenlabs":
      return new ElevenLabsVoiceProvider();
    case "openai":
      return new OpenAIVoiceProvider();
    case "cartesia":
      return new CartesiaVoiceProvider();
    case "voicestudio":
      return new VoiceStudioVoiceProvider();
    case "kokoro":
      return new KokoroVoiceProvider();
    case "fish-audio":
      return new FishAudioVoiceProvider();
    case "minimax":
      return new MiniMaxVoiceProvider();
    case "telnyx":
      return new TelnyxVoiceProvider();
    case "scripted":
      if (!scriptedVoiceEnabled()) break;
      return new ScriptedVoiceProvider();
    default:
      break;
  }
  throw new Error(
    `Unknown voice provider "${kind}". Use elevenlabs | openai | cartesia | voicestudio | kokoro | fish-audio | minimax | telnyx.`,
  );
}

export class NoVoiceConfigured extends Error {
  readonly reason: "key" | "voice";

  constructor(reason: "key" | "voice") {
    super(
      reason === "key"
        ? "Add a voice provider key in Voice settings to turn on speaking."
        : "Pick a voice in Voice settings.",
    );
    this.reason = reason;
    this.name = "NoVoiceConfigured";
  }
}

export const MAX_SPEAK_CHARS = 2000;
export const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;
