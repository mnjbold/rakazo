import type { MessageBlock } from "@rakazo/contracts";
import { couldBeSilentReply, isSilentReply } from "./live-call.js";

/** A fenced block becomes a mention of itself, with its language if known. */
function describeCodeBlock(fence: string): string {
  const lang =
    fence
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^a-z0-9+#]/gi, "") ?? "";
  const spoken: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    py: "Python",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    json: "JSON",
    yml: "YAML",
    yaml: "YAML",
    sql: "SQL",
    rs: "Rust",
    go: "Go",
    swift: "Swift",
    diff: "diff",
  };
  const name = spoken[lang.toLowerCase()];
  return name ? `. (a ${name} code block) ` : ". (a code block) ";
}

/** `a/b/c/file.ts` → `file.ts`. A path's directories are for the eye. */
function shortenPaths(text: string): string {
  return text.replace(/(?:[\w.@-]+\/){1,}([\w.-]+\.\w{1,6})\b/g, "$1");
}

const ENDS_SENTENCE = /[.!?:;]\s*$/;

/**
 * Markdown (or any agent output) → a line a voice can read.
 *
 * Say the prose, name the artifacts, drop the syntax. Pure and synchronous
 * so it stays easy to tune against real transcripts.
 */
export function speakable(input: string): string {
  if (!input) return "";
  let text = input;

  text = text.replace(/```([^\n]*)\n[\s\S]*?(?:```|$)/g, (_m, fence: string) =>
    describeCodeBlock(fence),
  );
  text = text.replace(/~~~([^\n]*)\n[\s\S]*?(?:~~~|$)/g, (_m, fence: string) =>
    describeCodeBlock(fence),
  );

  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) =>
    alt ? `. (image: ${alt}) ` : ". (an image) ",
  );
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/<https?:\/\/[^>\s]+>/g, " a link ");
  text = text.replace(/\bhttps?:\/\/\S+/g, " a link ");

  text = text.replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, "");
  text = text.replace(/^\s*\|(.+)\|\s*$/gm, (_m, row: string) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", "),
  );

  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    code.length <= 40 ? code : " that snippet ",
  );

  text = text.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_m, head: string) =>
    ENDS_SENTENCE.test(head) ? head : `${head.trim()}.`,
  );

  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+[.)]\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^\s*(?:[-*_]\s*){3,}$/gm, "");

  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  text = text.replace(/\[[ xX]\]\s*/g, "");

  text = shortenPaths(text);

  text = text.replace(
    /[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    "",
  );

  text = text.replace(/\n{2,}/g, ". ");
  text = text.replace(/\n/g, ". ");

  text = text.replace(/\s+/g, " ");
  text = text.replace(/\s+([.,!?;:])/g, "$1");
  text = text.replace(/(?:\.\s*){2,}/g, ". ");
  text = text.replace(/,\s*\./g, ".");
  text = text.trim();

  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

const BOUNDARY =
  /(?<!\b(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|No|approx))(?<![.\d])([.!?])(["')\]]*)\s+/g;

/**
 * Split speakable text into utterances a synthesizer can start on.
 * Short fragments are glued onto their neighbour so the voice keeps context.
 * maxChars bounds UTF-16 code units, matching the synthesis API's limit.
 */
export function toUtterances(input: string, { minChars = 12, maxChars = 320 } = {}): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 2) {
    throw new RangeError("maxChars must be an integer of at least 2");
  }
  return glueShort(
    roughSentences(speakable(input)).map((piece) => fitLength(piece, maxChars)),
    minChars,
    maxChars,
  );
}

function roughSentences(text: string): string[] {
  if (!text) return [];
  const MARK = "\u0000";
  return text
    .replace(BOUNDARY, `$1$2${MARK}`)
    .split(MARK)
    .map((s) => s.trim())
    .filter(Boolean);
}

function fitLength(piece: string, maxChars: number): string[] {
  return piece.length <= maxChars ? [piece] : splitLong(piece, maxChars);
}

/** Glue short fragments onto their neighbour; only the first part of a split sentence glues. */
function glueShort(
  groups: readonly (readonly string[])[],
  minChars = 12,
  maxChars = Number.POSITIVE_INFINITY,
): string[] {
  const out: string[] = [];
  for (const parts of groups) {
    for (const [index, part] of parts.entries()) {
      const prev = out[out.length - 1];
      if (
        index === 0 &&
        prev &&
        (prev.length < minChars || part.length < minChars) &&
        prev.length + 1 + part.length <= maxChars
      ) {
        out[out.length - 1] = `${prev} ${part}`;
      } else {
        out.push(part);
      }
    }
  }
  return out;
}

const CLOSED_SENTENCE = /[.!?]["')\]]*\s+$/;

/**
 * The sentences of a reply that can be spoken now: all of them once the reply is final, and
 * while it still streams only those already closed by a boundary, so a half-written sentence
 * never reaches the voice.
 */
export function readySentences(text: string, final: boolean, { maxChars = 320 } = {}): string[] {
  const pieces = roughSentences(speakable(text));
  if (!final && !CLOSED_SENTENCE.test(text)) pieces.pop();
  return pieces.flatMap((piece) => fitLength(piece, maxChars));
}

function sentenceKey(sentence: string): string {
  return sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * What one live-call turn has queued for speech. A streamed reply is spoken sentence by sentence
 * as it arrives, and the finished message (or a later rewrite of the same text) never repeats a
 * sentence already queued. The exact silent token, or a stream that could still become it, is
 * never spoken.
 */
export class SpeechTurn {
  private readonly queued = new Set<string>();
  private skipNext = false;

  /** New utterances to queue for `text`: a still-streaming reply, or a finished message when `final`. */
  take(text: string, final: boolean): string[] {
    if (final ? isSilentReply(text) : couldBeSilentReply(text)) return [];
    const fresh: string[] = [];
    for (const sentence of readySentences(text, final)) {
      const key = sentenceKey(sentence);
      if (!key || this.queued.has(key)) continue;
      this.queued.add(key);
      if (this.skipNext) {
        this.skipNext = false;
        continue;
      }
      fresh.push(sentence);
    }
    return glueShort(fresh.map((sentence) => [sentence]));
  }

  /**
   * The person talked over this reply. Nothing streamed so far is spoken later, including the
   * sentence that was still arriving.
   * ponytail: drops only the one open sentence; text the model keeps streaming after it still plays.
   */
  interrupt(streamText: string) {
    const closed = readySentences(streamText, false);
    for (const sentence of closed) this.queued.add(sentenceKey(sentence));
    this.skipNext = readySentences(streamText, true).length > closed.length;
  }
}

function splitLong(text: string, maxChars: number): string[] {
  const out: string[] = [];
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : undefined;
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const at = Math.max(
      window.lastIndexOf(", "),
      window.lastIndexOf("; "),
      window.lastIndexOf(" — "),
    );
    let cut = at > maxChars / 2 ? at + 1 : window.lastIndexOf(" ");
    if (cut <= 0) {
      cut = 0;
      if (segmenter) {
        for (const { index, segment } of segmenter.segment(rest)) {
          const end = index + segment.length;
          if (end > maxChars) break;
          cut = end;
        }
      }
      // A single grapheme may exceed the budget; older native runtimes may
      // also lack Segmenter. Still make progress without splitting a surrogate pair.
      if (cut === 0) {
        cut = maxChars;
        const last = rest.charCodeAt(cut - 1);
        if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
      }
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** A tool-activity chip as a spoken progress line. Null when it is not worth hearing. */
export function narrateTool(toolName: string): string | null {
  const name = toolName.replace(/^mcp__[^_]+__/, "").trim();
  if (!name) return null;
  if (/^(auto-approved|error):/i.test(name)) return null;

  const bare = name.toLowerCase();
  const verbs: Array<[RegExp, string]> = [
    [/^(bash|shell|terminal|run_command|execute|computer_exec)$/, "running a command"],
    [/^(read|read_file|view|list_files)$/, "reading a file"],
    [/^(write|write_file|create_file)$/, "writing a file"],
    [/^(edit|apply_patch|str_replace|multiedit)$/, "editing a file"],
    [/^(grep|search|glob|find)$/, "searching"],
    [/^(web_?search|websearch)$/, "searching the web"],
    [/^(web_?fetch|fetch)$/, "reading a page"],
    [/^(screenshot|computer_observe)$/, "looking at the screen"],
    [/^(browser_navigate|browser_snapshot|browser_act)$/, "using the page"],
    [/^(click|type_text|press_key|scroll|computer_batch|computer_act)$/, "using the computer"],
    [/^open_url$/, "opening a page"],
    [/^list_bots$/, "checking who's around"],
    [/^ask_bot$/, "asking a teammate"],
    [/^run_subagent$/, "starting a subagent"],
    [/^spawn_bot$/, "creating a bot"],
    [/^create_space$/, "creating a space"],
    [/^list_fleet$/, "checking your bots"],
    [/^create_group$/, "creating a group"],
    [/^update_group$/, "updating a group"],
    [/^organize_bot$/, "organizing the sidebar"],
    [/^set_child_instructions$/, "rewriting a bot's instructions"],
    [/^set_child_bot_model$/, "setting a bot's model"],
    [/^create_child_routine$/, "scheduling a routine"],
    [/^(archive_bot|delete_bot)$/, "archiving a bot"],
    [/^remember$/, "writing a memory"],
    [/^save_shared_memory$/, "saving shared memory"],
    [/^attach_file$/, "attaching a file"],
    [/^request_takeover$/, "asking you to take over"],
  ];
  for (const [pattern, phrase] of verbs) {
    if (pattern.test(bare)) return phrase;
  }
  const short = shortenPaths(name).slice(0, 40);
  return /^[\w .:/-]+$/.test(short) ? `running ${short}` : null;
}

export function speechFromBlocks(blocks: MessageBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "text" || block.kind === "progress" || block.kind === "meta")
        return block.text;
      if (block.kind === "ask") return block.text;
      if (block.kind === "cloud_agent")
        return `${block.title}: ${block.status}${block.prUrl ? ` ${block.prUrl}` : ""}`;
      if (block.kind === "computer") return block.text;
      if (block.kind === "subagent") {
        if (block.status === "running") return `${block.name} is working on ${block.task}`;
        if (block.status === "failed") return `${block.name} failed`;
        return block.result || `${block.name} finished`;
      }
      if (block.kind === "card") {
        return block.lines.map((line) => `${line.k}: ${line.v}`).join(". ");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

// Without its accent "si" is Spanish for "if", so only "sí" says yes. `\b` only knows
// ASCII letters, so a word ends wherever no letter or digit follows.
const YES =
  /^¡?(yes|yeah|yep|yup|ok|okay|sure|do it|go ahead|approve|confirmed|affirmative|sí|vale|okey|de acuerdo|adelante|hazlo|confirmo|aprobado)(?![\p{L}\p{N}])/iu;
const NO =
  /^¡?(no|nope|nah|cancel|stop|don't|do not|reject|deny|negative|cancela|cancelar|cancélalo|rechaza|rechazado|mejor no|detente)(?![\p{L}\p{N}])/iu;

/** Consent must never be inferred from a sentence that merely contained "sure". */
export function spokenDecision(transcript: string): "yes" | "no" | null {
  const text = transcript.trim();
  // A question ("¿Sí? ¿Cuáles?") is not an answer.
  if (!text || /[?¿]/.test(text) || text.split(/\s+/).length > 6) return null;
  if (YES.test(text)) return "yes";
  if (NO.test(text)) return "no";
  return null;
}

const FILLER =
  /^(?:u+h+|u+m+|h+m+|m+h*m*|a+h+|o+h+|e+r+m*|hu+h|mhm|uh-?huh|ok|okay|yeah|right|so|and|the|a)$/i;

/**
 * True for a live-call transcript that is background noise or a filler, not a turn meant for the
 * bot: no letters, only filler words, or a single character. Callers skip this check while the
 * bot is waiting on a spoken answer, where "yes" or "ok" is a real reply.
 */
export function isNoiseUtterance(transcript: string): boolean {
  const words = transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  if (words.every((word) => FILLER.test(word))) return true;
  return words.length === 1 && (words[0]?.length ?? 0) < 2;
}
