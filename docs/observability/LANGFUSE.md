# Langfuse observability — rakazo

Every LLM call, agent step, eval score and cost for this repo lands in **one place**:
Langfuse project **`rakazo`** (org *Bijou*) at https://langfuse.getbijou.xyz.

| Thing | Where |
|---|---|
| Langfuse project | `rakazo` — id in `.env` as `LANGFUSE_PROJECT_ID` |
| LLM gateway | `LLM_BASE_URL=https://llm.getbijou.xyz/v1` (LiteLLM, OpenAI-compatible) |
| Default model | `LLM_MODEL=MiniMax-M3` (`MiniMax-M3.1-Flash-Preview` = fast, no `<think>` block) |
| Repo virtual key | `LLM_API_KEY` (LiteLLM alias `repo-rakazo`, key-level logging → this Langfuse project) |
| Secrets (source of truth) | Infisical `vault.getbijou.xyz` → project `infra` / env `prod` → `/services/langfuse-rakazo`, `/services/litellm-rakazo` |
| Local copy | `.env` (gitignored). Names only in `.env.example` |
| Smoke test | `python observability/langfuse_smoke.py` |
| Code helper | `observability/langfuse.mjs` |
| Onboarding state | `.langfuse-onboarding.json` (`pending` → `verified` after the user confirms) |

## 1. Get the secrets (once per machine)

```
python %USERPROFILE%\.langfuse-onboarding\fetch_secrets.py .
```

It asks the platform for this repo's keys over an encrypted one-shot channel and merges them into
`.env` (backup `.env.pre-langfuse.bak` if a value changes). It never prints a secret. Needs
`pip install cryptography` and the Dokploy entry in `~/.claude.json`.
Never paste keys into chat, commits, docs or logs.

## 2. What is traced

| Signal | How |
|---|---|
| Every LLM call through the gateway | LiteLLM logs it to this project automatically (key-level Langfuse logging on `repo-rakazo`) — model, input/output, tokens, **cost**, latency, errors |
| App-level traces / spans | `observability/langfuse.mjs` (see §4) — nest LLM calls, tool calls, retrieval, agent steps under one trace |
| Scores | smoke test (`smoke_ok`), LLM-as-judge evaluators, user feedback, unit-eval results |

**Trace attributes — always set them** (they are how you filter, group and compare):

- `session_id` — one conversation / job run / agent session
- `user_id` — end user or `agent:<name>` for autonomous runs
- `tags` — at least `repo:rakazo`, plus feature/agent tags (`agent:planner`, `feature:search`)
- `release` — git short sha (helpers default to `git rev-parse --short HEAD`, override with `LANGFUSE_RELEASE`)
- `environment` — `LANGFUSE_TRACING_ENVIRONMENT` (`development` locally, `production` in deploys)

Through the gateway, pass them in the request body `metadata`:
`{"trace_id", "trace_name", "session_id", "trace_user_id", "tags", "trace_release", "generation_name"}`.

## 3. Metrics you get for free

Langfuse → *Dashboard*: cost per day/model/user/release, p50/p95 latency, token usage, error rate,
score trends. Filter by tag `repo:rakazo`, `release`, `environment`. Compare releases before
and after a prompt change.

> **Cost needs a price table.** MiniMax models have no built-in price, so cost shows `0` until a
> model definition exists: Langfuse → *Settings → Models → Add* (match `(anthropic/)?MiniMax-M3.*`,
> set input/output price per token), or `model_info.input_cost_per_token` in the LiteLLM config.

## 4. Wiring the app (minimal, non-invasive)

Zero-dependency helper `observability/langfuse.mjs`: `chat(messages, {sessionId, userId, tags, name})` calls the gateway with trace metadata (the gateway writes the generation into this project) and `score(traceId, name, value)` attaches evals. For nested spans adopt the official SDK: `@langfuse/tracing` + `@langfuse/otel` (NodeSDK + `LangfuseSpanProcessor`) and `observeOpenAI` from `@langfuse/openai` around an `openai` client with `baseURL: process.env.LLM_BASE_URL`.

**Integration point (TODO — not changed automatically, to keep this commit non-invasive):** `packages/adapters/src/pi-openai-compatible-provider.ts` is the OpenAI-compatible provider used by `apps/api/src/router.ts` (env in `apps/api/src/env.ts`). Set its base URL/key from `LLM_BASE_URL`/`LLM_API_KEY` and pass the trace `metadata` per request (see `observability/langfuse.mjs`).

Note: with the Python SDK wrapper the gateway *also* logs each call (as its own trace named after
the request). Use the SDK trace for app-level analysis; the gateway trace is the cost/usage
ledger. Pass `metadata={"trace_id": ...}` through the gateway if you want them merged.

## 5. Eval loop (quality you can measure)

1. **Datasets from real traces** — in Langfuse open a good or bad trace → *Add to dataset*
   (`rakazo-golden`, `rakazo-regressions`). Aim for 20–50 items per core flow; add every bug.
2. **Evaluators** — Langfuse → *Evaluators* → LLM-as-judge (via the gateway model): correctness,
   helpfulness, hallucination, format. Run on new traces (sampled) and on dataset runs.
3. **Scores** — every eval writes a score on the trace (`score-create` / SDK `score`). Human review
   via *Annotation queues*. User thumbs up/down → score `user_feedback`.
4. **Dataset runs before release** — run the app over the dataset, compare scores against the last
   release. No release if the core scores drop.

## 6. Prompt management

Keep production prompts in Langfuse *Prompts* (versioned, labels `production` / `staging`), fetch
them at runtime by name + label, and link the prompt to the generation so every trace shows which
prompt version produced it. Roll back = move the `production` label.

## 7. Self-improvement loop (weekly, agents do this)

1. **Collect** — filter traces with low scores (`smoke_ok=0`, judge < threshold, negative
   feedback), errors, or high cost/latency from the last 7 days.
2. **Diagnose** — for each cluster write one lesson: symptom → root cause → fix.
3. **Record** — append lessons to `docs/observability/LESSONS.md` (this repo) and to the shared
   vault journal (https://notes.getbijou.xyz, `journal/`), dated, with trace links.
4. **Improve** — update the prompt (new Langfuse prompt version), add the failing traces to the
   regression dataset, adjust code or model routing.
5. **Re-evaluate** — run the dataset again; promote the prompt label only if scores improve.
6. **Track** — the weekly score/cost trend is the evidence the system is getting better.

## 8. First task every session

See the top of `CLAUDE.md` / `AGENTS.md`: env check → smoke test → confirm the trace → report →
wait for the user's OK → set `.langfuse-onboarding.json` to `verified` → continue dev work.
