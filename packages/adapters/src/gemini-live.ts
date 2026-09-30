import type { LiveConnectConfig, LiveServerMessage } from "@google/genai";
import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveVoiceConfig, LiveVoiceFrame, LiveVoiceSession } from "@rakazo/adapter-kit";

/**
 * Bridges the Gemini Live API WebSocket session to the LiveVoiceSession interface.
 * The TypeScript SDK uses callbacks; we adapt them to an async-iterable push queue.
 */
export class GeminiLiveSession implements LiveVoiceSession {
  private session: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null = null;
  private readonly pendingFrames: LiveVoiceFrame[] = [];
  private resolve: (() => void) | null = null;
  private closed = false;
  private readonly apiKey: string;
  private readonly config: LiveVoiceConfig;

  constructor(apiKey: string, config: LiveVoiceConfig) {
    this.apiKey = apiKey;
    this.config = config;
  }

  async open(): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    const liveConfig: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(this.config.systemInstruction
        ? { systemInstruction: { parts: [{ text: this.config.systemInstruction }] } }
        : {}),
      ...(this.config.voiceId
        ? {
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: this.config.voiceId } },
            },
          }
        : {}),
    };

    this.session = await ai.live.connect({
      model: "gemini-3.1-flash-live-preview",
      config: liveConfig,
      callbacks: {
        onopen: () => {
          // Seed history context items if provided
          if (this.config.history?.length && this.session) {
            for (const item of this.config.history) {
              const role = item.role === "user" ? "user" : "model";
              this.session.sendClientContent({
                turns: [{ role, parts: [{ text: item.text }] }],
                turnComplete: false,
              });
            }
          }
        },
        onmessage: (msg: LiveServerMessage) => {
          this.handleMessage(msg);
        },
        onerror: (_e: ErrorEvent) => {
          this.pushFrame({ control: "session_end" });
        },
        onclose: () => {
          if (!this.closed) {
            this.pushFrame({ control: "session_end" });
          }
          this.closed = true;
          this.resolve?.();
          this.resolve = null;
        },
      },
    });
  }

  sendAudio(chunk: Uint8Array): void {
    if (!this.session) return;
    const data = Buffer.from(chunk).toString("base64");
    this.session.sendRealtimeInput({
      audio: { data, mimeType: "audio/pcm;rate=16000" },
    });
  }

  sendAudioEnd(): void {
    if (!this.session) return;
    this.session.sendRealtimeInput({ audioStreamEnd: true });
  }

  receive(): AsyncIterable<LiveVoiceFrame> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<LiveVoiceFrame> {
        return {
          async next(): Promise<IteratorResult<LiveVoiceFrame>> {
            while (true) {
              const frame = self.pendingFrames.shift();
              if (frame !== undefined) {
                return { value: frame, done: false };
              }
              if (self.closed) {
                return { value: undefined as unknown as LiveVoiceFrame, done: true };
              }
              await new Promise<void>((res) => {
                self.resolve = res;
              });
            }
          },
        };
      },
    };
  }

  close(): void {
    if (this.session) {
      try {
        this.session.close();
      } catch {
        // ignore — session may already be closed
      }
    }
    this.closed = true;
    this.resolve?.();
    this.resolve = null;
  }

  static async open(apiKey: string, config: LiveVoiceConfig): Promise<GeminiLiveSession> {
    const instance = new GeminiLiveSession(apiKey, config);
    await instance.open();
    return instance;
  }

  private pushFrame(frame: LiveVoiceFrame): void {
    this.pendingFrames.push(frame);
    const res = this.resolve;
    this.resolve = null;
    res?.();
  }

  private handleMessage(msg: LiveServerMessage): void {
    const content = msg.serverContent;
    if (!content) return;

    // Interruption signal
    if (content.interrupted) {
      this.pushFrame({ control: "interrupted" });
    }

    // Audio chunks from the model
    const parts = content.modelTurn?.parts;
    if (parts) {
      for (const part of parts) {
        const b64 = part.inlineData?.data;
        if (b64) {
          const bytes = new Uint8Array(Buffer.from(b64, "base64"));
          this.pushFrame({ audio: bytes });
        }
      }
    }

    // User (input) transcription
    const inputText = content.inputTranscription?.text;
    if (inputText) {
      this.pushFrame({ transcript: { role: "user", text: inputText } });
    }

    // Bot (output) transcription
    const outputText = content.outputTranscription?.text;
    if (outputText) {
      this.pushFrame({ transcript: { role: "bot", text: outputText } });
    }
  }
}
