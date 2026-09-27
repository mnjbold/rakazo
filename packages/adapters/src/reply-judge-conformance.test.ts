import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ReplyJudge } from "@rakazo/adapter-kit";
import { REPLY_CHECK_IDS } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReplyJudge, JevReplyJudge } from "./jev-reply-judge.js";
import { ReplyJudgeEmulator } from "./reply-judge-emulator.js";

type Seen = { auth: string | undefined; body: Record<string, unknown> };
const seen: Seen[] = [];
let mode: "ok" | "error" | "partial" | "slow" = "ok";
let server: Server;
let baseUrl = "";

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ auth: req.headers.authorization, body });
    if (mode === "slow") return; // never answers; the client timeout must fire
    if (mode === "error") {
      res.writeHead(500).end("boom");
      return;
    }
    const ids = Object.keys(body.questions as object);
    const answers = Object.fromEntries(
      ids
        .slice(0, mode === "partial" ? 1 : ids.length)
        .map((id, index) => [id, { type: "noul", noul: index / 10 }]),
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ model: "jev-test", answers }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const judges: Array<[string, () => ReplyJudge]> = [
  ["jev", () => new JevReplyJudge({ apiKey: "test-key", baseUrl, timeoutMs: 500 })],
  ["emulator", () => new ReplyJudgeEmulator()],
];

describe.each(judges)("ReplyJudge conformance: %s", (_name, make) => {
  it("scores every check as a 0–1 probability", async () => {
    mode = "ok";
    const result = await make().judge({ userRequest: "What time is it?", reply: "It is 3pm." });
    expect(Object.keys(result?.scores ?? {}).sort()).toEqual([...REPLY_CHECK_IDS].sort());
    for (const score of Object.values(result!.scores)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("skips empty and credential-bearing replies", async () => {
    const judge = make();
    const before = seen.length;
    expect(await judge.judge({ userRequest: "hi", reply: "  " })).toBeNull();
    for (const reply of [
      "Your key is sk-abcdefghijklmnopqrstuv",
      "token ghp_abcdefghijklmnopqrstuvwxyz",
      "AKIAABCDEFGHIJKLMNOP",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmnop",
      "-----BEGIN PRIVATE KEY-----",
    ]) {
      expect(await judge.judge({ userRequest: "hi", reply })).toBeNull();
    }
    expect(seen.length).toBe(before);
  });
});

describe("JevReplyJudge", () => {
  const judge = () => new JevReplyJudge({ apiKey: "test-key", baseUrl, timeoutMs: 300 });

  it("sends the System One request shape", async () => {
    mode = "ok";
    await judge().judge({ userRequest: "Q", reply: "A", botInstructions: "Be brief" });
    const last = seen.at(-1)!;
    expect(last.auth).toBe("Bearer test-key");
    expect(last.body).toMatchObject({
      model: "jev-latest",
      state: { user_request: "Q", agent_reply: "A", bot_instructions: "Be brief" },
    });
    const questions = last.body.questions as Record<string, { type: string; criteria: object }>;
    expect(Object.keys(questions).sort()).toEqual([...REPLY_CHECK_IDS].sort());
    expect(questions.jargon).toMatchObject({
      type: "noul",
      criteria: { true: expect.any(String) },
    });
  });

  it.each(["error", "partial", "slow"] as const)("fails open on %s", async (next) => {
    mode = next;
    expect(await judge().judge({ userRequest: "Q", reply: "A" })).toBeNull();
    mode = "ok";
  });

  it("fails open when the endpoint is unreachable", async () => {
    const offline = new JevReplyJudge({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:9",
      timeoutMs: 300,
    });
    expect(await offline.judge({ userRequest: "Q", reply: "A" })).toBeNull();
  });

  it("is disabled without a TypeSafe key", () => {
    expect(createReplyJudge({})).toBeNull();
    expect(createReplyJudge({ TYPESAFE_API_KEY: "  " })).toBeNull();
    expect(createReplyJudge({ TYPESAFE_API_KEY: "k" })).toBeInstanceOf(JevReplyJudge);
  });
});

describe("ReplyJudgeEmulator", () => {
  it("scores a rambling reply worse than a short clear one", async () => {
    const emulator = new ReplyJudgeEmulator();
    const rambling = await emulator.judge({
      userRequest: "How do I reset my password?",
      reply: `${"First, the OAuth endpoint issues a JSON payload through the API middleware. ".repeat(12)}\n${"- detail\n".repeat(10)}`,
    });
    const clear = await emulator.judge({
      userRequest: "How do I reset my password?",
      reply: "Open Settings, then tap Reset password.",
    });
    expect(rambling!.scores.too_long_or_complex).toBeGreaterThan(0.5);
    expect(rambling!.scores.jargon).toBeGreaterThan(0.5);
    expect(clear!.scores.too_long_or_complex).toBeLessThan(0.5);
    expect(clear!.scores.jargon).toBeLessThan(0.5);
  });
});
