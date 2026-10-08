import { useLingui } from "@lingui/react/macro";
import type { LiveInterruption, ThreadMessage, ThreadSnapshot } from "@rakazo/contracts";
import { LIVE_INTERRUPTION_HEARD_MAX_LENGTH } from "@rakazo/contracts";
import {
  endOfTurnSilenceMs,
  isNoiseUtterance,
  isSecretAskBlock,
  isSilentReply,
  isUsingComputer,
  narrateTool,
  SpeechTurn,
  speechFromBlocks,
  spokenDecision,
} from "@rakazo/core";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { Mic, MicOff, Settings, X } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { startBargeInMonitor } from "../lib/barge-in";
import { dictation } from "../lib/dictation";
import type { LiveSession } from "../lib/live-session.js";
import { speaker } from "../lib/tts";
import "./live-call.css";

type Phase = "listening" | "thinking" | "speaking";

const RUN_ACTIVE = ["running", "queued", "leased"];
// An ambient assistant narrates sparingly: at most this many progress lines per run.
const MAX_NARRATIONS_PER_RUN = 2;

export function CallView({
  botId,
  botName,
  botColor,
  transcribe,
  snapshot,
  screen,
  onSend,
  onFollowUp,
  onAnswer,
  onOpenComputer,
  onOpenSettings,
  onClose,
  liveMode,
}: {
  botId: string;
  botName: string;
  botColor: string;
  transcribe: boolean;
  snapshot: ThreadSnapshot | null;
  /** The bot's live computer screen, when it is running and embeddable. */
  screen: { url: string; sandbox?: string } | null;
  onSend: (text: string, interruption?: LiveInterruption) => Promise<void>;
  onFollowUp: (text: string, interruption?: LiveInterruption) => Promise<void>;
  onAnswer: (message: ThreadMessage, text: string) => Promise<void>;
  onOpenComputer: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  /** When true, use LiveSession (WebSocket + AudioWorklet) instead of dictation/speaker. */
  liveMode?: boolean;
}) {
  const { t } = useLingui();
  const [phase, setPhase] = useState<Phase>("listening");
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const endBargeInRef = useRef<() => void>(() => undefined);
  const phaseRef = useRef<Phase>("listening");
  const heardRef = useRef("");
  const spokenMessage = useRef<string | null>(null);
  // The bot reply the person last talked over, sent with their next turn and then cleared.
  const interruption = useRef<LiveInterruption | null>(null);
  // What the current run has queued for speech, so a streamed reply is never spoken twice.
  const speechTurn = useRef<{ runId: string | null; turn: SpeechTurn }>({
    runId: null,
    turn: new SpeechTurn(),
  });
  const narrated = useRef(new Set<string>());
  const narrationRun = useRef<{ runId: string | null; count: number }>({ runId: null, count: 0 });
  const closing = useRef(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const orbRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const askPromptRef = useRef(t`Say yes or no, or answer in a sentence.`);
  askPromptRef.current = t`Say yes or no, or answer in a sentence.`;
  const secretPromptRef = useRef(t`Hang up first, then enter the code on screen.`);
  secretPromptRef.current = t`Hang up first, then enter the code on screen.`;
  /** Holds the active LiveSession instance when liveMode is true. */
  const liveSessionRef = useRef<LiveSession | null>(null);

  const runActive = Boolean(snapshot?.run && RUN_ACTIVE.includes(snapshot.run.status));
  const lastReply = [...(snapshot?.messages ?? [])]
    .reverse()
    .find((m) => m.role === "bot" && !isStreamMessage(m));
  // A small live preview appears only while the bot is actually driving its browser or desktop.
  const usingComputer =
    runActive &&
    (snapshot?.messages ?? []).some(
      (message) => message.runId === snapshot?.run?.id && isUsingComputer(message.blocks),
    );
  const showScreen = Boolean(screen && usingComputer);

  function setCallPhase(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function hangUp() {
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      onClose();
      return;
    }
    closing.current = true;
    dictation.stop("cancel");
    speaker.stop();
    onClose();
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      endBargeInRef.current();
      dictation.stop("cancel");
      setHeard("");
      heardRef.current = "";
    } else if (phaseRef.current !== "speaking") void listen();
  }

  function interrupt() {
    if (liveSessionRef.current) {
      liveSessionRef.current.interrupt();
      return;
    }
    if (phaseRef.current === "speaking") {
      const { messageId } = speaker.state;
      const spoken = speaker.state.heard?.trim().slice(0, LIVE_INTERRUPTION_HEARD_MAX_LENGTH);
      if (messageId && spoken && !messageId.startsWith("narrate:")) {
        interruption.current = { messageId, heard: spoken };
      }
      // Nothing of the reply talked over plays later, including sentences still streaming in.
      const runId = messageId?.startsWith("run:") ? messageId.slice(4) : null;
      if (runId) turnFor(runId).interrupt(streamedText(streamMessage(snapshotRef.current, runId)));
      speaker.stop();
    } else dictation.stop("cancel");
    void listen();
  }

  async function listen() {
    if (closing.current) return;
    if (mutedRef.current) {
      setCallPhase("listening");
      return;
    }
    setHeard("");
    heardRef.current = "";
    if (pendingSecretAsk(snapshotRef.current)) {
      dictation.stop("cancel");
      setCallPhase("listening");
      return;
    }
    setCallPhase("listening");
    speaker.stop();
    try {
      await dictation.listen({
        mode: "endpoint",
        transcribe,
        endpointMs: endOfTurnSilenceMs,
        onFinal: (text) => void handleTranscript(text),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Microphone failed`);
    }
  }

  async function handleTranscript(text: string) {
    const current = snapshotRef.current;
    const askId = latestAskId(current);
    // Background noise and fillers are not turns. While the bot waits on an answer, "ok" is one.
    if (closing.current || (!askId && isNoiseUtterance(text))) {
      void listen();
      return;
    }
    dictation.stop("submit");
    if (pendingSecretAsk(current)) {
      setHeard("");
      setCaption("");
      setError(t`Hang up, then enter the code on screen.`);
      return;
    }
    setSaid(text);
    setHeard("");
    heardRef.current = "";
    setError(null);
    const askMessage = current?.messages.find((message) => message.id === askId);
    const talkedOver = resolveInterruption(current, interruption.current);
    interruption.current = null;
    try {
      if (askMessage) {
        await onAnswer(askMessage, spokenDecision(text) ?? text);
      } else if (current?.run && RUN_ACTIVE.includes(current.run.status)) {
        await onFollowUp(text, talkedOver);
      } else {
        await onSend(text, talkedOver);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Could not send that`);
    }
    // Keep listening while the bot works, so the conversation never stalls on one turn.
    void listen();
  }

  function say(text: string, messageId: string) {
    replyStarts(messageId);
    void speaker.speak(text, { botId, messageId });
  }

  /** Queue reply sentences as they become ready; one speech key per run keeps them in one queue. */
  function sayQueued(utterances: string[], messageId: string) {
    if (!utterances.length) return;
    replyStarts(messageId);
    speaker.enqueue(utterances, { botId, messageId });
  }

  function replyStarts(messageId: string) {
    // A newer reply replaces the one talked over; narration and the rest of that reply do not.
    if (!messageId.startsWith("narrate:") && interruption.current?.messageId !== messageId) {
      interruption.current = null;
    }
    dictation.stop("cancel");
  }

  function turnFor(runId: string | null): SpeechTurn {
    if (speechTurn.current.runId !== runId) {
      speechTurn.current = { runId, turn: new SpeechTurn() };
    }
    return speechTurn.current.turn;
  }

  // Live session effect: when liveMode is true, manage a LiveSession instead of dictation/speaker.
  useEffect(() => {
    if (!liveMode) return;
    let session: LiveSession | null = null;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      const { LiveSession: LS } = await import("../lib/live-session.js");
      const { selectedSpaceId } = await import("../lib/rpc.js");
      session = new LS();
      unsubscribe = session.subscribe((s) => {
        // Map live session phase to existing CallView Phase type
        const livePhase: Phase =
          s.phase === "connecting" || s.phase === "thinking"
            ? "thinking"
            : s.phase === "speaking"
              ? "speaking"
              : "listening";
        setCallPhase(livePhase);
        setHeard(s.heard);
        setCaption(s.caption ?? "");
        if (s.error) setError(s.error);
      });
      session.setTranscriptCallback((role, text) => {
        if (role === "user") {
          setSaid(text);
          setHeard("");
          heardRef.current = "";
        }
      });
      await session.open(selectedSpaceId());
      liveSessionRef.current = session;
    })();

    return () => {
      unsubscribe?.();
      session?.close();
      liveSessionRef.current = null;
    };
  }, [botId, liveMode]);

  useEffect(() => {
    // The dictation/speaker path is not used in live mode.
    if (liveMode) return;
    closing.current = false;
    spokenMessage.current = latestBotId(snapshotRef.current);
    narrated.current.clear();
    // A call opened mid-run starts with what streams next, not what was already on screen.
    const openRun = snapshotRef.current?.run?.id ?? null;
    if (openRun)
      turnFor(openRun).interrupt(streamedText(streamMessage(snapshotRef.current, openRun)));
    // Talking over the bot stops it and hands the turn back to the person.
    let stopBargeIn: (() => void) | null = null;
    let bargeInStarting = false;
    const endBargeIn = () => {
      stopBargeIn?.();
      stopBargeIn = null;
    };
    endBargeInRef.current = endBargeIn;
    const unsubSpeech = speaker.subscribe((state) => {
      if (state.status === "speaking") {
        setCallPhase("speaking");
        setCaption(state.caption ?? "");
        // Muted means the mic stays off, so talking over the bot is not listened for either.
        if (!stopBargeIn && !bargeInStarting && !mutedRef.current) {
          bargeInStarting = true;
          void startBargeInMonitor(() => {
            stopBargeIn = null;
            if (phaseRef.current === "speaking" && !mutedRef.current) interrupt();
          })
            .then((stop) => {
              if (closing.current || mutedRef.current || phaseRef.current !== "speaking") stop();
              else stopBargeIn = stop;
            })
            .catch(() => undefined)
            .finally(() => {
              bargeInStarting = false;
            });
        }
      } else if (state.status === "idle") {
        endBargeIn();
        if (phaseRef.current === "speaking") void listen();
      }
      if (state.error) setError(state.error);
    });
    const unsubDictation = dictation.subscribe((state) => {
      if (state.status === "listening") {
        const text = pendingSecretAsk(snapshotRef.current) ? "" : state.transcript;
        heardRef.current = text;
        setHeard(text);
      }
      if (state.error) setError(state.error);
    });
    void listen();
    return () => {
      closing.current = true;
      endBargeIn();
      unsubSpeech();
      unsubDictation();
      dictation.stop("cancel");
      speaker.stop();
    };
  }, [botId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // A dialog opened from the call (voice settings) handles its own keys.
      if (event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        hangUp();
      }
      // Typing in the composer stays typing while on a call.
      if (event.key === " " && phaseRef.current === "speaking" && !isTypingTarget(event.target)) {
        event.preventDefault();
        interrupt();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Speak replies as they stream, sentence by sentence, then only what the finished message adds.
  // Replies are never dropped because the call is listening; they wait only while the person is
  // mid-sentence (heard is non-empty) and play once they pause.
  useEffect(() => {
    if (closing.current || heard) return;
    const run = snapshot?.run;
    if (runActive && run) {
      const stream = streamMessage(snapshot, run.id);
      if (stream) sayQueued(turnFor(run.id).take(streamedText(stream), false), `run:${run.id}`);
    }
    if (lastReply && lastReply.id !== spokenMessage.current) {
      const text = speechFromBlocks(lastReply.blocks);
      const ask = lastReply.blocks.find(
        (block) => block.kind === "ask" && block.status !== "answered",
      );
      if (isSilentReply(text)) {
        spokenMessage.current = lastReply.id;
        return;
      }
      if (text) {
        spokenMessage.current = lastReply.id;
        const suffix =
          ask && isSecretAskBlock(ask)
            ? `. ${secretPromptRef.current}`
            : ask
              ? `. ${askPromptRef.current}`
              : "";
        const runId = lastReply.runId ?? null;
        sayQueued(
          turnFor(runId).take(`${text}${suffix}`, true),
          runId ? `run:${runId}` : lastReply.id,
        );
        return;
      }
      if (!runActive) spokenMessage.current = lastReply.id;
    }
    if (!runActive || phaseRef.current === "speaking" || speaker.state.status !== "idle") return;
    const runId = snapshot?.run?.id ?? null;
    if (narrationRun.current.runId !== runId) narrationRun.current = { runId, count: 0 };
    if (narrationRun.current.count >= MAX_NARRATIONS_PER_RUN) return;
    for (const message of snapshot?.messages ?? []) {
      for (const block of message.blocks) {
        // Assistant-written text streams through the sentence queue above; narrate only tool status.
        if (block.kind === "progress" && !block.activity) continue;
        if (block.kind !== "progress" && block.kind !== "subagent") continue;
        const phrase =
          block.kind === "subagent"
            ? narrateTool("run_subagent")
            : (narrateTool(block.text.split(/\s+/)[0] ?? "") ?? speakableProgress(block.text));
        const key = `${message.id}:${block.kind}`;
        if (!phrase || narrated.current.has(key) || narrated.current.has(phrase)) {
          narrated.current.add(key);
          continue;
        }
        narrated.current.add(key);
        narrated.current.add(phrase);
        narrationRun.current.count += 1;
        say(phrase, `narrate:${key}`);
        return;
      }
    }
  }, [snapshot, botId, heard, runActive, lastReply]);

  useEffect(() => {
    if (!pendingSecretAsk(snapshot)) return;
    dictation.stop("cancel");
    setHeard("");
  }, [snapshot]);

  // Drive the orb and wave from the real mic level while listening, and from a soft synthetic
  // envelope while speaking or working. Writes CSS variables directly; no React re-render.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array<ArrayBuffer> | null = null;
    let micStream: MediaStream | null = null;

    if (typeof window !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          micStream = stream;
          const AudioCtor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!AudioCtor) return;
          const ctx = new AudioCtor();
          audioCtx = ctx;
          const source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.65;
          source.connect(analyser);
          freqData = new Uint8Array(analyser.frequencyBinCount);
        })
        .catch(() => undefined);
    }

    const tick = (now: number) => {
      const p = phaseRef.current;
      let micRms = 0;
      if (analyser && freqData && p === "listening") {
        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i += 1) {
          sum += freqData[i]!;
        }
        micRms = sum / (freqData.length * 255);
      } else {
        micRms = liveMode ? (liveSessionRef.current?.level ?? 0) : dictation.level;
      }

      const level =
        p === "listening"
          ? micRms
          : p === "speaking"
            ? 0.45 + 0.35 * Math.abs(Math.sin(now / 130)) * Math.abs(Math.cos(now / 270))
            : 0.16 + 0.1 * Math.sin(now / 380);

      orbRef.current?.style.setProperty("--live-level", level.toFixed(3));
      const bars = waveRef.current?.children;
      if (bars) {
        for (let i = 0; i < bars.length; i += 1) {
          let scale = 0.14;
          if (p === "listening") {
            if (freqData && micRms > 0.03) {
              const bin = Math.min(i, freqData.length - 1);
              const val = (freqData[bin] ?? 0) / 255;
              scale = Math.max(0.14, Math.min(1, val * 2.2));
            } else {
              const wobble = Math.abs(Math.sin(now / (240 + i * 22) + i));
              scale = heardRef.current
                ? Math.max(0.2, 0.45 + 0.45 * wobble)
                : Math.max(0.14, 0.14 + 0.12 * wobble);
            }
          } else if (p === "speaking") {
            const speechWobble =
              Math.abs(Math.sin(now / 110 + i * 0.45)) * Math.abs(Math.cos(now / 190 + i * 0.32));
            scale = Math.max(0.16, Math.min(1, 0.32 + 0.68 * speechWobble));
          } else {
            const ripple = Math.abs(Math.sin(now / 160 - i * 0.28));
            scale = Math.max(0.14, 0.22 + 0.6 * ripple);
          }
          (bars[i] as HTMLElement).style.transform = `scaleY(${scale.toFixed(3)})`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (micStream) {
        for (const track of micStream.getTracks()) track.stop();
      }
      if (audioCtx) {
        void audioCtx.close().catch(() => undefined);
      }
    };
  }, [liveMode]);

  const colorStyle = { "--live-color": botColor } as CSSProperties;
  const status = muted
    ? t`Muted`
    : phase === "speaking"
      ? t`Speaking`
      : runActive
        ? t`Working`
        : heard
          ? t`Hearing you`
          : t`Listening`;

  const activeTask = activeTaskFromSnapshot(snapshot);

  return (
    <section
      data-testid="call-view"
      aria-label={t`Live call with ${botName}`}
      style={colorStyle}
      className="live-bar"
    >
      <div className="live-card-body border border-border bg-card/95 shadow-xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={interrupt}
            aria-label={phase === "speaking" ? t`Interrupt` : t`Listen again`}
            className="grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <div
              ref={orbRef}
              className="live-orb"
              data-phase={runActive && phase !== "speaking" ? "thinking" : phase}
            >
              <div className="live-orb-halo" />
              <BotAvatar
                color={botColor}
                identity={botId}
                size={34}
                variant="organic"
                status={runActive || phase === "speaking" ? "running" : undefined}
              />
            </div>
          </button>
          <span className="sr-only" aria-live="polite">
            {status}
          </span>
          <div
            ref={waveRef}
            className="live-wave"
            data-muted={muted || undefined}
            aria-hidden="true"
          >
            {WAVE_BARS.map((bar) => (
              <span key={bar} />
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Voice settings`}
            title={t`Voice settings`}
            className="size-11 shrink-0 rounded-full text-muted-foreground"
            onClick={onOpenSettings}
          >
            <Settings size={18} strokeWidth={1.8} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Mute`}
            title={t`Mute`}
            aria-pressed={muted}
            className="size-11 shrink-0 rounded-full text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            onClick={toggleMute}
          >
            {muted ? <MicOff size={18} strokeWidth={1.8} /> : <Mic size={18} strokeWidth={1.8} />}
          </Button>
          <Button
            variant="destructive"
            size="icon"
            aria-label={t`Hang up`}
            title={t`Hang up`}
            className="size-11 shrink-0 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/85"
            onClick={hangUp}
          >
            <X size={18} strokeWidth={2.2} />
          </Button>
        </div>

        {activeTask ? (
          <div className="flex items-center gap-2 pt-1">
            <span className="live-task-pill truncate">
              <span className="inline-block animate-pulse">⚡</span>
              {activeTask}
            </span>
          </div>
        ) : null}

        <div className="flex min-w-0 items-start justify-between gap-3 pt-1">
          <div className="min-w-0 flex-1">
            {error ? (
              <p className="text-[13px] text-destructive">{error}</p>
            ) : phase === "speaking" && caption ? (
              <p className="live-transcript-turn text-foreground" dir="auto" aria-live="polite">
                <span className="font-semibold text-primary">{botName}: </span>
                {caption}
              </p>
            ) : heard ? (
              <p className="live-transcript-turn text-foreground/90" dir="auto" aria-live="polite">
                <span className="font-medium text-muted-foreground">{t`You`}: </span>
                {heard}
              </p>
            ) : said ? (
              <p
                className="live-transcript-turn text-muted-foreground"
                dir="auto"
                aria-live="polite"
              >
                <span className="font-medium text-muted-foreground/75">{t`You`}: </span>
                {said}
              </p>
            ) : (
              <p className="text-[12.5px] italic text-muted-foreground/60">{t`Listening…`}</p>
            )}
          </div>
          {showScreen && screen ? (
            <button
              type="button"
              onClick={onOpenComputer}
              aria-label={t`Open ${botName}'s computer`}
              title={t`Open ${botName}'s computer`}
              className="live-stage-enter pointer-events-auto relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-black shadow-md hover:ring-2 hover:ring-primary"
            >
              <iframe
                title={t`${botName}'s screen`}
                src={screen.url}
                sandbox={screen.sandbox}
                tabIndex={-1}
                className="size-full border-0"
                style={{ pointerEvents: "none" }}
              />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const WAVE_BARS = Array.from({ length: 24 }, (_, index) => index);

function latestBotId(snapshot: ThreadSnapshot | null): string | null {
  const messages = snapshot?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "bot" && !isStreamMessage(message)) return message.id;
  }
  return null;
}

function isStreamMessage(message: ThreadMessage): boolean {
  return message.id.startsWith("progress:");
}

function streamMessage(snapshot: ThreadSnapshot | null, runId: string): ThreadMessage | undefined {
  return snapshot?.messages.find((message) => message.id === `progress:${runId}`);
}

/** What the run's assistant has written so far; tool status lines are not part of the reply. */
function streamedText(message: ThreadMessage | undefined): string {
  return (message?.blocks ?? [])
    .map((block) =>
      block.kind === "text" || (block.kind === "progress" && !block.activity) ? block.text : "",
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * A reply talked over while it streamed is keyed by its run; send it as that run's durable reply
 * once one exists. Until then the server has no message to attach it to, so it is left out.
 */
function resolveInterruption(
  snapshot: ThreadSnapshot | null,
  talkedOver: LiveInterruption | null,
): LiveInterruption | undefined {
  if (!talkedOver) return undefined;
  if (!talkedOver.messageId.startsWith("run:")) return talkedOver;
  const runId = talkedOver.messageId.slice(4);
  const reply = snapshot?.messages.findLast(
    (message) => message.role === "bot" && message.runId === runId && !isStreamMessage(message),
  );
  return reply ? { messageId: reply.id, heard: talkedOver.heard } : undefined;
}

function pendingSecretAsk(snapshot: ThreadSnapshot | null) {
  const askId = latestAskId(snapshot);
  const askMessage = snapshot?.messages.find((message) => message.id === askId);
  return askMessage?.blocks.some(
    (block) => block.kind === "ask" && isSecretAskBlock(block) && block.status !== "answered",
  );
}

function latestAskId(snapshot: ThreadSnapshot | null): string | null {
  if (snapshot?.run?.status !== "waiting_input") return null;
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.runId !== snapshot.run.id) continue;
    if (message.blocks.some((block) => block.kind === "ask" && block.status !== "answered")) {
      return message.id;
    }
  }
  return null;
}

function speakableProgress(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return trimmed;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function activeTaskFromSnapshot(snapshot: ThreadSnapshot | null): string | null {
  if (!snapshot?.run || !RUN_ACTIVE.includes(snapshot.run.status)) return null;
  const messages = snapshot.messages;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.runId !== snapshot.run.id) continue;
    for (let b = msg.blocks.length - 1; b >= 0; b -= 1) {
      const block = msg.blocks[b];
      if (block?.kind === "progress" && block.text) {
        const text = block.text.trim();
        if (text && !text.startsWith("Thinking")) return text;
      }
      if (block?.kind === "subagent") {
        return "Subagent running…";
      }
    }
  }
  return null;
}
