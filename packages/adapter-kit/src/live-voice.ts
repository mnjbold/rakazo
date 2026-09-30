// packages/adapter-kit/src/live-voice.ts

export interface LiveVoiceFrame {
  /** Raw PCM audio bytes (Int16, little-endian) */
  audio?: Uint8Array;
  /** Control message type */
  control?: "interrupted" | "session_end";
  /** Transcription text (for thread record) */
  transcript?: { role: "user" | "bot"; text: string };
}

export interface LiveVoiceSession {
  /** Send a PCM audio chunk from the user microphone */
  sendAudio(chunk: Uint8Array): void;
  /** Signal that the user has stopped speaking (helps VAD) */
  sendAudioEnd(): void;
  /** Receive frames: audio from the model or control signals */
  receive(): AsyncIterable<LiveVoiceFrame>;
  /** Close the session cleanly */
  close(): void;
}

export interface LiveVoiceConfig {
  systemInstruction?: string;
  voiceId?: string;
  /** History items to seed the session context */
  history?: Array<{ role: "user" | "bot"; text: string }>;
}
