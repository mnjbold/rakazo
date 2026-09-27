import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type {
  LiveInterruption,
  MessageBlock,
  ThreadMessage,
  ThreadSnapshot,
} from "@rakazo/contracts";
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
import { PhoneOff } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ArtifactFileCard } from "../components/ArtifactFileCard";
import type { ArtifactTarget } from "../lib/artifact-open";
import { startBargeInMonitor } from "../lib/barge-in";
import { dictation } from "../lib/dictation";
import { speaker } from "../lib/tts";
import { ArtifactImage, ChartBlockView } from "./shell/message-cards";
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
  artifactTarget,
  onSend,
  onFollowUp,
  onAnswer,
  onOpenComputer,
  onClose,
}: {
  botId: string;
  botName: string;
  botColor: string;
  transcribe: boolean;
  snapshot: ThreadSnapshot | null;
  /** The bot's live computer screen, when it is running and embeddable. */
  screen: { url: string; sandbox?: string } | null;
  artifactTarget: ArtifactTarget;
  onSend: (text: string, interruption?: LiveInterruption) => Promise<void>;
  onFollowUp: (text: string, interruption?: LiveInterruption) => Promise<void>;
  onAnswer: (message: ThreadMessage, text: string) => Promise<void>;
  onOpenComputer: () => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [phase, setPhase] = useState<Phase>("listening");
  const [caption, setCaption] = useState("");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  const runActive = Boolean(snapshot?.run && RUN_ACTIVE.includes(snapshot.run.status));
  const lastBot = [...(snapshot?.messages ?? [])].reverse().find((m) => m.role === "bot");
  const lastReply = [...(snapshot?.messages ?? [])]
    .reverse()
    .find((m) => m.role === "bot" && !isStreamMessage(m));
  const media = latestMediaBlock(lastBot);
  // The live screen appears only while the bot works, so an idle call stays a small card.
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
    closing.current = true;
    dictation.stop("cancel");
    speaker.stop();
    onClose();
  }

  function interrupt() {
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

  useEffect(() => {
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
    const unsubSpeech = speaker.subscribe((state) => {
      if (state.status === "speaking") {
        setCallPhase("speaking");
        setCaption(state.caption ?? "");
        if (!stopBargeIn && !bargeInStarting) {
          bargeInStarting = true;
          void startBargeInMonitor(() => {
            stopBargeIn = null;
            if (phaseRef.current === "speaking") interrupt();
          })
            .then((stop) => {
              if (closing.current || phaseRef.current !== "speaking") stop();
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
      if (event.key === "Escape") {
        event.preventDefault();
        hangUp();
      }
      if (event.key === " " && phaseRef.current === "speaking") {
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
    const tick = (now: number) => {
      const p = phaseRef.current;
      const level =
        p === "listening"
          ? dictation.level
          : p === "speaking"
            ? 0.35 + 0.3 * Math.abs(Math.sin(now / 140)) * Math.abs(Math.sin(now / 310))
            : 0.12 + 0.08 * Math.sin(now / 420);
      orbRef.current?.style.setProperty("--live-level", level.toFixed(3));
      const bars = waveRef.current?.children;
      if (bars) {
        for (let i = 0; i < bars.length; i += 1) {
          const wobble = Math.abs(Math.sin(now / (180 + i * 37) + i));
          const scale = Math.max(0.14, Math.min(1, level * (0.55 + wobble)));
          (bars[i] as HTMLElement).style.transform = `scaleY(${scale.toFixed(3)})`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const colorStyle = { "--live-color": botColor } as CSSProperties;
  const status =
    phase === "speaking"
      ? t`Speaking`
      : runActive
        ? t`Working`
        : heard
          ? t`Hearing you`
          : t`Listening`;

  const line =
    error ??
    (phase === "speaking" && caption
      ? caption
      : heard || said
        ? `${t`You`}: ${heard || said}`
        : t`Talk anytime. I stay quiet unless you need me.`);
  const showMedia = Boolean(media && (runActive || phase === "speaking"));

  return (
    <section
      data-testid="call-view"
      aria-label={t`Live call with ${botName}`}
      style={colorStyle}
      className="mx-3 mb-2 overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:mx-6"
    >
      <div className="flex min-w-0 items-center gap-2.5 px-2.5 py-1.5">
        <button
          type="button"
          onClick={interrupt}
          aria-label={phase === "speaking" ? t`Interrupt` : t`Listen again`}
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
              size={32}
              variant="organic"
              status={runActive || phase === "speaking" ? "running" : undefined}
            />
          </div>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground" dir="auto">
              {botName}
            </span>
            <span className="shrink-0 text-[11.5px] text-muted-foreground" aria-live="polite">
              {status}
            </span>
            <div ref={waveRef} className="live-wave" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
          <p
            className={`truncate text-[12.5px] ${error ? "text-destructive" : "text-muted-foreground"}`}
            dir="auto"
            aria-live="polite"
          >
            {line}
          </p>
        </div>
        {showScreen && screen ? (
          <button
            type="button"
            onClick={onOpenComputer}
            aria-label={t`Open ${botName}'s computer`}
            title={t`Open ${botName}'s computer`}
            className="live-stage-enter relative size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-black"
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
        <Button
          variant="destructive"
          size="icon"
          aria-label={t`Hang up`}
          title={t`Hang up`}
          className="size-8 shrink-0 rounded-full"
          onClick={hangUp}
        >
          <PhoneOff size={15} strokeWidth={1.9} />
        </Button>
      </div>
      {showMedia && media ? (
        <div className="live-stage-enter mx-2.5 mb-2 max-h-40 overflow-auto rounded-xl border border-border bg-background p-2">
          <MediaBlock block={media} target={artifactTarget} />
        </div>
      ) : null}
    </section>
  );
}

type MediaKind = Extract<MessageBlock, { kind: "image" | "file" | "chart" }>;

/** The newest visual result in the bot's reply: a chart, image, file, or table-bearing text. */
function latestMediaBlock(
  message: ThreadMessage | undefined,
): MediaKind | { kind: "table"; text: string } | null {
  if (!message) return null;
  for (let i = message.blocks.length - 1; i >= 0; i -= 1) {
    const block = message.blocks[i];
    if (!block) continue;
    if (block.kind === "image" || block.kind === "file" || block.kind === "chart") return block;
    if (block.kind === "text" && /^\s*\|.+\|\s*$/m.test(block.text)) {
      return { kind: "table", text: block.text };
    }
  }
  return null;
}

function MediaBlock({
  block,
  target,
}: {
  block: MediaKind | { kind: "table"; text: string };
  target: ArtifactTarget;
}) {
  if (block.kind === "table") return <ChatMarkdown>{block.text}</ChatMarkdown>;
  if (block.kind === "chart") {
    return <ChartBlockView name={block.name} spec={block.spec} data={block.data} />;
  }
  if (block.kind === "image") {
    return <ArtifactImage target={target} artifactId={block.artifactId} name={block.name} />;
  }
  return (
    <ArtifactFileCard
      target={target}
      artifactId={block.artifactId}
      name={block.name}
      mimeType={block.mimeType}
      size={block.size}
    />
  );
}

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
