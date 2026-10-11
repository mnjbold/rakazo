// Langfuse observability + LLM gateway helper for rakazo — zero dependencies (Node 18+ / Deno / edge).
//
//   import { chat, score } from "../observability/langfuse.mjs";
//   const { text, traceId } = await chat([{ role: "user", content: "hi" }],
//     { sessionId: "chat-123", userId: "u-42", tags: ["feature:qa"], name: "qa-answer" });
//   await score(traceId, "user_feedback", 1, "thumbs up");
//
// Every call goes through the LiteLLM gateway (LLM_BASE_URL) with this repo's virtual key; the
// gateway logs the generation (model, tokens, cost, latency) into this repo's Langfuse project and
// the trace attributes below make it filterable. For full nested spans use the official SDK
// (`@langfuse/tracing` + `@langfuse/otel` + `@langfuse/openai`) — see docs/observability/LANGFUSE.md §4.
// Server-side only: never ship LLM_API_KEY / LANGFUSE_SECRET_KEY to a browser bundle.

const REPO = "rakazo";
const env = (k, d) => (globalThis.process?.env?.[k] ?? globalThis.Deno?.env?.get?.(k) ?? d);
const hex = () => crypto.randomUUID().replaceAll("-", "");

export async function chat(messages, { model, name = "chat", sessionId, userId, tags = [], traceId = hex(), ...extra } = {}) {
  const res = await fetch(`${env("LLM_BASE_URL").replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("LLM_API_KEY")}` },
    body: JSON.stringify({
      model: model ?? env("LLM_MODEL", "MiniMax-M3"),
      messages,
      ...extra,
      metadata: {
        trace_id: traceId,
        trace_name: name,
        generation_name: name,
        session_id: sessionId,
        trace_user_id: userId,
        trace_release: env("LANGFUSE_RELEASE", "dev"),
        tags: [`repo:${REPO}`, `env:${env("LANGFUSE_TRACING_ENVIRONMENT", "development")}`, ...tags],
      },
    }),
  });
  if (!res.ok) throw new Error(`LLM gateway HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const text = (body.choices?.[0]?.message?.content ?? "").split("</think>").pop().trim();
  return { text, traceId, usage: body.usage, raw: body };
}

export async function score(traceId, name, value, comment) {
  const auth = btoa(`${env("LANGFUSE_PUBLIC_KEY")}:${env("LANGFUSE_SECRET_KEY")}`);
  const res = await fetch(`${env("LANGFUSE_HOST").replace(/\/$/, "")}/api/public/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ traceId, name, value, comment, dataType: "NUMERIC" }),
  });
  if (!res.ok) throw new Error(`Langfuse score HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
