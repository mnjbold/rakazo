import type { ReplyJudge, ReplyJudgeRequest } from "@rakazo/adapter-kit";
import type { ReplyCheckId } from "@rakazo/contracts";
import { REPLY_CHECK_IDS } from "@rakazo/contracts";
import { DEFAULT_JEV_MODEL, typesafeApiKey } from "./auto-review.js";
import { readBodyCapped } from "./web-ssrf.js";

const JEV_BASE_URL = "https://api.typesafe.ai";
const TIMEOUT_MS = 8_000;
const MAX_JSON_BYTES = 64_000;
const MAX_REQUEST_CHARS = 2_000;
const MAX_REPLY_CHARS = 6_000;
const MAX_INSTRUCTIONS_CHARS = 1_000;

const CREDENTIAL_PATTERN =
  /\bsk-[A-Za-z0-9_-]{16,}|\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|PRIVATE KEY-----/;

/** Replies that look credential-bearing are never sent to a remote judge. */
export function looksCredentialBearing(text: string): boolean {
  return CREDENTIAL_PATTERN.test(text);
}

export const REPLY_CHECK_QUESTIONS: Record<
  ReplyCheckId,
  { instructions: string; criteria: { true: string; false: string } }
> = {
  too_long_or_complex: {
    instructions:
      "Is the agent reply longer or more complex than a non-technical person needs for this request?",
    criteria: {
      true: "Longer or more complex than needed; a few short plain lines or bullets would do",
      false: "About as short and simple as the request allows",
    },
  },
  unclear_structure: {
    instructions: "Is the reply hard to scan, without a clear answer first?",
    criteria: {
      true: "No clear answer up front, or hard to scan",
      false: "Leads with the answer and is easy to scan",
    },
  },
  unsupported_claim: {
    instructions:
      "Does the reply claim something is done, verified, or working without evidence it was done with tools in this turn?",
    criteria: {
      true: "Claims completion or verification without shown evidence",
      false: "Makes no such claim, or backs it with concrete evidence",
    },
  },
  missed_request: {
    instructions: "Does the reply fail to address what the user actually asked?",
    criteria: {
      true: "Misses or sidesteps the request",
      false: "Addresses what was asked",
    },
  },
  jargon: {
    instructions: "Does the reply use unexplained technical jargon for a general user?",
    criteria: {
      true: "Uses technical terms a general user would not know, unexplained",
      false: "Plain language, or terms are explained",
    },
  },
};

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Live Jev answers `{ type: "noul", noul: 0.04 }`; also accepts value/probability/score. */
function readScore(answer: unknown): number | null {
  if (!answer || typeof answer !== "object") return null;
  const record = answer as Record<string, unknown>;
  for (const key of ["noul", "probability", "score", "value"]) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
    if (key === "value" && typeof raw === "boolean") return raw ? 1 : 0;
  }
  return null;
}

export interface JevReplyJudgeOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** TypeSafe Jev ("System One") over HTTP. Fail-open: every failure resolves to null. */
export class JevReplyJudge implements ReplyJudge {
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: JevReplyJudgeOptions) {
    this.url = `${(options.baseUrl ?? JEV_BASE_URL).replace(/\/+$/, "")}/v1/systemone`;
    this.model = options.model ?? DEFAULT_JEV_MODEL;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async judge(request: ReplyJudgeRequest, signal?: AbortSignal) {
    if (!request.reply.trim() || looksCredentialBearing(`${request.userRequest}\n${request.reply}`))
      return null;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        redirect: "error",
        signal: bounded,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          state: {
            user_request: truncate(request.userRequest, MAX_REQUEST_CHARS),
            agent_reply: truncate(request.reply, MAX_REPLY_CHARS),
            ...(request.botInstructions?.trim()
              ? { bot_instructions: truncate(request.botInstructions, MAX_INSTRUCTIONS_CHARS) }
              : {}),
          },
          questions: Object.fromEntries(
            REPLY_CHECK_IDS.map((id) => [id, { type: "noul", ...REPLY_CHECK_QUESTIONS[id] }]),
          ),
        }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return null;
      }
      const bytes = await readBodyCapped(response, MAX_JSON_BYTES, bounded);
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { answers?: unknown };
      const answers = (parsed?.answers ?? {}) as Record<string, unknown>;
      const scores = {} as Record<ReplyCheckId, number>;
      for (const id of REPLY_CHECK_IDS) {
        const score = readScore(answers[id]);
        if (score === null) return null;
        scores[id] = score;
      }
      return { scores };
    } catch {
      return null;
    }
  }
}

/** Reply self-review is on only when a TypeSafe key is configured. */
export function createReplyJudge(env: NodeJS.ProcessEnv = process.env): ReplyJudge | null {
  const apiKey = typesafeApiKey(env);
  return apiKey ? new JevReplyJudge({ apiKey }) : null;
}
