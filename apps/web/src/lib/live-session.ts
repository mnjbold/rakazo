import { selectedSpaceId } from "./rpc.js";
import { PCM_WORKLET_SOURCE } from "./pcm-worklet.js";

export type LiveSessionPhase =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

export interface LiveSessionState {
  phase: LiveSessionPhase;
  /** Live mic level 0..1 (poll only, don't subscribe) */
  level: number;
  caption: string;
  heard: string;
  error: string | null;
}

type Listener = (state: LiveSessionState) => void;
type TranscriptCallback = (role: "user" | "bot", text: string) => void;

const LIVE_WS_PATH = "/api/voice/live";

export class LiveSession {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private micStream: MediaStream | null = null;
  private playbackNode: ScriptProcessorNode | null = null;
  private playbackQueue: Int16Array[] = [];
  private playbackOffset = 0;
  private playbackActive = false;
  private listeners = new Set<Listener>();
  private state: LiveSessionState = {
    phase: "connecting",
    level: 0,
    caption: "",
    heard: "",
    error: null,
  };
  private closed = false;
  private onTranscript: TranscriptCallback | null = null;

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  get currentState(): LiveSessionState {
    return this.state;
  }

  /** level 0..1 — poll don't subscribe (rAF loop) */
  get level(): number {
    return this.state.level;
  }

  setTranscriptCallback(fn: TranscriptCallback) {
    this.onTranscript = fn;
  }

  private setState(patch: Partial<LiveSessionState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn(this.state);
  }

  async open(spaceId: string | null): Promise<void> {
    if (this.closed) return;
    this.setState({ phase: "connecting", error: null });

    // Build WebSocket URL from current origin
    const url = new URL(LIVE_WS_PATH, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (spaceId) url.searchParams.set("spaceId", spaceId);

    const ws = new WebSocket(url.toString());
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      if (this.closed) {
        ws.close();
        return;
      }
      this.setState({ phase: "listening" });
      void this.startMic();
    };

    ws.onmessage = (event) => {
      if (this.closed) return;
      if (typeof event.data === "string") {
        this.handleControlFrame(event.data);
      } else {
        // Binary: PCM audio from the model
        this.handleAudioFrame(event.data as ArrayBuffer);
      }
    };

    ws.onerror = () => {
      this.setState({
        phase: "error",
        error: "Connection failed. Check your voice settings.",
      });
    };

    ws.onclose = () => {
      this.stopMic();
      this.stopPlayback();
      if (!this.closed && this.state.phase !== "error") {
        this.setState({ phase: "ended" });
      }
    };
  }

  private handleControlFrame(raw: string) {
    try {
      const frame = JSON.parse(raw) as Record<string, unknown>;
      if (frame.type === "interrupted") {
        // Clear playback queue immediately
        this.playbackQueue = [];
        this.playbackOffset = 0;
        this.playbackActive = false;
        this.setState({ phase: "listening", caption: "" });
      } else if (frame.type === "transcript") {
        const role = frame.role as "user" | "bot";
        const text = String(frame.text ?? "");
        if (role === "user") this.setState({ heard: text });
        if (role === "bot") this.setState({ caption: text });
        this.onTranscript?.(role, text);
      } else if (frame.type === "error") {
        this.setState({
          phase: "error",
          error: String(frame.message ?? "Voice error"),
        });
        this.close();
      }
    } catch {
      // Ignore malformed frames
    }
  }

  private handleAudioFrame(buffer: ArrayBuffer) {
    if (buffer.byteLength === 0) return;
    const samples = new Int16Array(buffer);
    this.playbackQueue.push(samples);
    if (!this.playbackActive) {
      this.setState({ phase: "speaking" });
      this.playbackActive = true;
    }
  }

  private async startMic() {
    if (this.closed) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.closed) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.micStream = stream;

      const ctx = new AudioContext();
      this.audioCtx = ctx;

      // Load worklet from blob URL
      const blob = new Blob([PCM_WORKLET_SOURCE], {
        type: "application/javascript",
      });
      const workletUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "pcm-capture");
      this.workletNode = worklet;

      // PCM chunks from worklet → WebSocket
      worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(e.data);
        }
        // Update mic level for orb animation
        const samples = new Int16Array(e.data);
        let sum = 0;
        for (const s of samples) sum += (s / 32768) * (s / 32768);
        this.state.level = Math.min(1, Math.sqrt(sum / samples.length) * 6);
      };

      source.connect(worklet);
      worklet.connect(ctx.destination); // needed for worklet to process

      // Playback: ScriptProcessorNode drains the queue
      const bufSize = 4096;
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const playback = ctx.createScriptProcessor(bufSize, 0, 1);
      this.playbackNode = playback;
      playback.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        let written = 0;
        while (written < out.length && this.playbackQueue.length > 0) {
          const chunk = this.playbackQueue[0]!;
          const remaining = chunk.length - this.playbackOffset;
          const canWrite = Math.min(remaining, out.length - written);
          for (let i = 0; i < canWrite; i++) {
            out[written + i] = (chunk[this.playbackOffset + i]! / 32768);
          }
          written += canWrite;
          this.playbackOffset += canWrite;
          if (this.playbackOffset >= chunk.length) {
            this.playbackQueue.shift();
            this.playbackOffset = 0;
          }
        }
        // Fill rest with silence
        for (let i = written; i < out.length; i++) out[i] = 0;
        // If queue drained and was playing, go back to listening
        if (this.playbackQueue.length === 0 && this.playbackActive) {
          this.playbackActive = false;
          if (this.state.phase === "speaking") {
            this.setState({ phase: "listening", caption: "" });
          }
        }
      };
      playback.connect(ctx.destination);
    } catch (err) {
      this.setState({
        phase: "error",
        error:
          err instanceof Error ? err.message : "Microphone access denied",
      });
    }
  }

  private stopMic() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
    this.state.level = 0;
  }

  private stopPlayback() {
    this.playbackQueue = [];
    this.playbackOffset = 0;
    this.playbackActive = false;
    if (this.playbackNode) {
      this.playbackNode.disconnect();
      this.playbackNode = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
  }

  /** Interrupt the bot mid-speech and go back to listening */
  interrupt() {
    this.playbackQueue = [];
    this.playbackOffset = 0;
    this.playbackActive = false;
    this.setState({ phase: "listening", caption: "" });
    // Send a zero-byte frame to signal audio stream end (helps server-side VAD reset)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(new ArrayBuffer(0));
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopMic();
    this.stopPlayback();
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }
    this.setState({ phase: "ended" });
  }
}

// Re-export selectedSpaceId so callers can use this module as a single import
export { selectedSpaceId };
