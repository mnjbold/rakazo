/**
 * Decides when the person starts talking over the bot. Fed mic loudness (RMS) every tick, it
 * learns the room's noise floor (including any echo of the bot's own voice that the browser's
 * echo cancellation lets through) and only fires on speech that is clearly louder than that
 * floor and sustained, so a cough, a door, or steady background chatter does not interrupt.
 * ponytail: loudness + duration, not speaker identity; a louder nearby voice can still interrupt.
 */
export class BargeInDetector {
  private floor = 0.01;
  private aboveMs = 0;
  private elapsedMs = 0;

  constructor(
    private readonly options = {
      tickMs: 50,
      /** Learn the floor only, never fire, while the bot's audio starts. */
      warmupMs: 400,
      sustainMs: 250,
      minLevel: 0.045,
      floorRatio: 3,
    },
  ) {}

  /** Feed one loudness sample (0..1). Returns true once sustained speech is detected. */
  push(rms: number): boolean {
    const { tickMs, warmupMs, sustainMs, minLevel, floorRatio } = this.options;
    this.elapsedMs += tickMs;
    const threshold = Math.max(minLevel, this.floor * floorRatio);
    if (this.elapsedMs <= warmupMs || rms <= threshold) {
      this.aboveMs = 0;
      this.floor = this.floor * 0.9 + rms * 0.1;
      return false;
    }
    this.aboveMs += tickMs;
    return this.aboveMs >= sustainMs;
  }
}

function audioContextCtor(): (new () => AudioContext) | undefined {
  if (typeof AudioContext === "function") return AudioContext;
  return (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/**
 * Listens to the mic while the bot speaks and calls onSpeech once the person talks over it.
 * Returns a stop function; it is safe to call more than once.
 */
export async function startBargeInMonitor(onSpeech: () => void): Promise<() => void> {
  const Ctor = audioContextCtor();
  if (!Ctor || !navigator.mediaDevices?.getUserMedia) return () => undefined;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new Ctor();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  if (ctx.state === "suspended") void ctx.resume();
  const data = new Uint8Array(analyser.fftSize);
  const detector = new BargeInDetector();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
    void ctx.close().catch(() => undefined);
  };
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const n = (sample - 128) / 128;
      sum += n * n;
    }
    if (detector.push(Math.sqrt(sum / data.length))) {
      stop();
      onSpeech();
    }
  }, 50);
  return stop;
}
