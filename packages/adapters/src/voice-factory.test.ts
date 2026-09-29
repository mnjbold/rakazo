import { createLogger, createTestSink, installLogger } from "@rakazo/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CartesiaVoiceProvider } from "./cartesia-voice.js";
import { ElevenLabsVoiceProvider } from "./elevenlabs-voice.js";
import { FishAudioVoiceProvider } from "./fish-audio-voice.js";
import { KokoroVoiceProvider } from "./kokoro-voice.js";
import { MiniMaxVoiceProvider } from "./minimax-voice.js";
import { OpenAIVoiceProvider } from "./openai-voice.js";
import {
  SCRIPTED_MPEG,
  SCRIPTED_TRANSCRIPT,
  SCRIPTED_VOICE_ID,
  ScriptedVoiceProvider,
} from "./scripted-voice.js";
import { TelnyxVoiceProvider } from "./telnyx-voice.js";
import {
  createVoiceProvider,
  isVoiceProviderId,
  listVoiceCatalog,
  VOICE_CATALOG,
} from "./voice-factory.js";
import { MAX_SYNTHESIZED_AUDIO_BYTES, MAX_VOICE_JSON_BYTES } from "./voice-http.js";
import { VoiceStudioVoiceProvider } from "./voicestudio-voice.js";

const ctx = {
  operationId: "voice",
  traceId: "voice",
  spaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

const previousRuntime = process.env.AGENT_RUNTIME;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (previousRuntime === undefined) delete process.env.AGENT_RUNTIME;
  else process.env.AGENT_RUNTIME = previousRuntime;
  installLogger(createLogger({ service: "rakazo", level: "off", sinks: [] }));
});

describe("createVoiceProvider", () => {
  it("exposes the hosted catalog behind one factory", () => {
    process.env.AGENT_RUNTIME = "pi";
    expect(VOICE_CATALOG.map((entry) => entry.id)).toEqual([
      "elevenlabs",
      "openai",
      "cartesia",
      "voicestudio",
      "kokoro",
      "fish-audio",
      "minimax",
      "telnyx",
    ]);
    expect(listVoiceCatalog().map((entry) => entry.id)).toEqual([
      "elevenlabs",
      "openai",
      "cartesia",
      "voicestudio",
      "kokoro",
      "fish-audio",
      "minimax",
      "telnyx",
    ]);
    expect(createVoiceProvider("elevenlabs").describe().id).toBe("elevenlabs");
    expect(createVoiceProvider("openai").describe().capabilities.transcribe).toBe(true);
    expect(createVoiceProvider("cartesia").describe().capabilities.transcribe).toBe(false);
    expect(createVoiceProvider("voicestudio").describe().capabilities.transcribe).toBe(true);
    expect(createVoiceProvider("kokoro").describe().capabilities.transcribe).toBe(false);
    expect(createVoiceProvider("minimax").describe().capabilities.transcribe).toBe(false);
    expect(createVoiceProvider("telnyx").describe().capabilities.transcribe).toBe(true);
    expect(isVoiceProviderId("kokoro")).toBe(true);
    expect(createVoiceProvider("fish-audio").describe().capabilities.transcribe).toBe(true);
    expect(isVoiceProviderId("elevenlabs")).toBe(true);
    expect(isVoiceProviderId("scripted")).toBe(false);
    expect(isVoiceProviderId("piper")).toBe(false);
    expect(() => createVoiceProvider("piper")).toThrow(/unknown voice provider/i);
    expect(() => createVoiceProvider("scripted")).toThrow(/unknown voice provider/i);
  });

  it("adds the scripted fixture only when the agent runtime is scripted", () => {
    process.env.AGENT_RUNTIME = "scripted";
    expect(listVoiceCatalog().some((entry) => entry.id === "scripted")).toBe(true);
    expect(isVoiceProviderId("scripted")).toBe(true);
    expect(createVoiceProvider("scripted").describe().id).toBe("scripted");
  });
});

describe("ElevenLabsVoiceProvider", () => {
  it("verifies against /voices so restricted speech keys still pass", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ voices: [{ voice_id: "abc", name: "Rachel" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsVoiceProvider();
    await expect(provider.verify("sk_test_key", ctx)).resolves.toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/voices");
  });

  it("synthesizes one utterance as mp3 bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ElevenLabsVoiceProvider();
    const clip = await provider.synthesize(
      { text: "Hello there.", voiceId: "abc", apiKey: "sk_test_key" },
      ctx,
    );
    expect(clip.mimeType).toBe("audio/mpeg");
    expect([...clip.bytes]).toEqual([1, 2, 3]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/text-to-speech/abc");
  });

  it("transcribes through Scribe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hello there" }))),
    );
    const provider = new ElevenLabsVoiceProvider();
    await expect(
      provider.transcribe!(
        { audio: new Uint8Array([1]), mimeType: "audio/webm", apiKey: "sk" },
        ctx,
      ),
    ).resolves.toEqual({ text: "hello there" });
  });
});

describe("OpenAIVoiceProvider", () => {
  it("returns a static voice catalog without a network round trip", async () => {
    const provider = new OpenAIVoiceProvider();
    const voices = await provider.listVoices("sk-test", ctx);
    expect(voices.some((voice) => voice.id === "alloy")).toBe(true);
  });

  it("posts speech to /audio/speech", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    const clip = await new OpenAIVoiceProvider().synthesize(
      { text: "Hi", voiceId: "alloy", apiKey: "sk-test" },
      ctx,
    );
    expect(clip.mimeType).toBe("audio/mpeg");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/audio/speech");
  });

  it("names Firefox ogg recordings from the mime type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hello" })));
    vi.stubGlobal("fetch", fetchMock);
    await new OpenAIVoiceProvider().transcribe!(
      { audio: new Uint8Array([1]), mimeType: "audio/ogg;codecs=opus", apiKey: "sk-test" },
      ctx,
    );
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("speech.ogg");
  });
});

describe("CartesiaVoiceProvider", () => {
  it("maps the voices list from either array or { data } payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ id: "sonic", name: "Katie" }] })),
        ),
    );
    const provider = new CartesiaVoiceProvider();
    const voices = await provider.listVoices("sk-test", ctx);
    expect(voices).toEqual([{ id: "sonic", label: "Katie", description: undefined }]);
  });

  // An unbounded /voices request returns the whole catalog, overruns the voice JSON read cap
  // and fails connecting the provider outright.
  it("bounds the voices request so the catalog cannot overrun the read cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new CartesiaVoiceProvider();

    await provider.verify("sk-test", ctx);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=1");

    await provider.listVoices("sk-test", ctx);
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/voices\?limit=\d+$/);

    // `limit` is ignored by the version synthesis is pinned to, so both reads must ask for a
    // version that paginates.
    for (const call of fetchMock.mock.calls) {
      const headers = (call[1] as { headers: Record<string, string> }).headers;
      expect(headers["Cartesia-Version"]).toBe("2026-08-14");
    }
  });

  it("follows the catalog cursor so voices past the first page are listed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "a", name: "A" }], has_more: true, next_page: "a" }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "b", name: "B" }], has_more: false })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const voices = await new CartesiaVoiceProvider().listVoices("sk-test", ctx);

    expect(voices.map((voice) => voice.id)).toEqual(["a", "b"]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("starting_after=a");
    // The walk stops on the page that reports no more, rather than requesting forever.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstSignal = (fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)
      ?.signal;
    const secondSignal = (fetchMock.mock.calls[1]?.[1] as { signal?: AbortSignal } | undefined)
      ?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(secondSignal).toBe(firstSignal);
  });

  it("stops catalog walks at the page ceiling when has_more stays true", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      const page = fetchMock.mock.calls.length;
      return new Response(
        JSON.stringify({
          data: [{ id: `v${page}`, name: `Voice ${page}` }],
          has_more: true,
          next_page: `v${page}`,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const voices = await new CartesiaVoiceProvider().listVoices("sk-test", ctx);

    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(voices.map((voice) => voice.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `v${index + 1}`),
    );
    const signals = fetchMock.mock.calls.map(
      (call) => (call[1] as { signal?: AbortSignal } | undefined)?.signal,
    );
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals.every((signal) => signal === signals[0])).toBe(true);
  });

  it("keeps synthesis on the pinned API version", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    await new CartesiaVoiceProvider().synthesize(
      { text: "Hi", voiceId: "sonic", apiKey: "sk-test" },
      ctx,
    );

    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> } | undefined;
    expect(init?.headers["Cartesia-Version"]).toBe("2024-06-10");
  });

  it("posts bytes to /tts/bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([4, 5]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    const clip = await new CartesiaVoiceProvider().synthesize(
      { text: "Hi", voiceId: "sonic", apiKey: "sk-test" },
      ctx,
    );
    expect([...clip.bytes]).toEqual([4, 5]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/tts/bytes");
    // mp3 takes bit_rate, not encoding: the documented shape is the only one Cartesia accepts.
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string })?.body ?? "{}");
    expect(body.output_format).toEqual({
      container: "mp3",
      sample_rate: 44100,
      bit_rate: 128000,
    });
    expect(body.model_id).toBe("sonic-3");
  });
});

describe("FishAudioVoiceProvider", () => {
  it("lists own then public voice models without duplicates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ _id: "public-id", title: "Public Voice", languages: ["en", "fr"] }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { _id: "private-id", title: "Private Voice", description: "My clone" },
              { _id: "public-id", title: "Duplicate" },
              { _id: "failed-id", title: "Failed", state: "failed" },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const voices = await new FishAudioVoiceProvider().listVoices("sk-test", ctx);

    expect(voices).toEqual([
      { id: "private-id", label: "Private Voice", description: "My clone" },
      { id: "public-id", label: "Duplicate" },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("page_size=100");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("self=true");
  });

  it("pages through Fish Audio model listings until has_more is false", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page_number") ?? "1");
      const own = url.searchParams.get("self") === "true";
      const prefix = own ? "own" : "pub";
      return new Response(
        JSON.stringify({
          total: 2,
          has_more: page < 2,
          items: [{ _id: `${prefix}-${page}`, title: `${own ? "Own" : "Public"} ${page}` }],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const voices = await new FishAudioVoiceProvider().listVoices("sk-test", ctx);

    expect(voices.map((voice) => voice.id)).toEqual(["own-1", "own-2", "pub-1", "pub-2"]);
    expect(voices.some((voice) => voice.label === "Public 2")).toBe(true);
    expect(voices.some((voice) => voice.label === "Own 2")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      fetchMock.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes("page_number=2")),
    ).toHaveLength(2);
  });

  it("keeps paging when total implies more pages without has_more", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page_number") ?? "1");
      const own = url.searchParams.get("self") === "true";
      if (own) {
        return new Response(
          JSON.stringify({ total: 1, items: [{ _id: "own-only", title: "Own" }] }),
        );
      }
      return new Response(
        JSON.stringify({
          total: 101,
          items:
            page === 1
              ? Array.from({ length: 100 }, (_, index) => ({
                  _id: `pub-${index + 1}`,
                  title: `Public ${index + 1}`,
                }))
              : [{ _id: "pub-101", title: "Public 101" }],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const voices = await new FishAudioVoiceProvider().listVoices("sk-test", ctx);

    expect(voices.some((voice) => voice.id === "pub-101")).toBe(true);
    expect(voices.some((voice) => voice.label === "Public 101")).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          String(call[0]).includes("page_number=2") && !String(call[0]).includes("self=true"),
      ),
    ).toBe(true);
  });

  it("stops catalog crawls at page caps when has_more stays true", async () => {
    const publicPages = 5;
    const ownPages = 20;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page_number") ?? "1");
      const own = url.searchParams.get("self") === "true";
      const prefix = own ? "own" : "pub";
      const start = (page - 1) * 100;
      return new Response(
        JSON.stringify({
          total: 1_000_000,
          has_more: true,
          items: Array.from({ length: 100 }, (_, index) => ({
            _id: `${prefix}-${start + index + 1}`,
            title: `${own ? "Own" : "Public"} ${start + index + 1}`,
          })),
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const voices = await new FishAudioVoiceProvider().listVoices("sk-test", ctx);

    expect(voices).toHaveLength(ownPages * 100 + publicPages * 100);
    expect(voices[0]?.id).toBe("own-1");
    expect(voices.at(ownPages * 100)?.id).toBe("pub-1");
    expect(
      fetchMock.mock.calls.filter((call) => String(call[0]).includes("self=true")),
    ).toHaveLength(ownPages);
    expect(
      fetchMock.mock.calls.filter((call) => !String(call[0]).includes("self=true")),
    ).toHaveLength(publicPages);
  });

  it("synthesizes with the Fish Audio TTS contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([7, 8]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const clip = await new FishAudioVoiceProvider().synthesize(
      { text: "Hi", voiceId: "voice-id", apiKey: "sk-test" },
      ctx,
    );

    expect(clip.mimeType).toBe("audio/mpeg");
    expect([...clip.bytes]).toEqual([7, 8]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.fish.audio/v1/tts");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).model).toBe("s2.1-pro");
    expect(JSON.parse(String(init.body))).toMatchObject({
      text: "Hi",
      reference_id: "voice-id",
      format: "mp3",
    });
  });

  it("sends FISH_TTS_MODEL when the key cannot use s2.1-pro", async () => {
    vi.stubEnv("FISH_TTS_MODEL", "s1");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    await new FishAudioVoiceProvider().synthesize(
      { text: "Hi", voiceId: "voice-id", apiKey: "sk-test" },
      ctx,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).model).toBe("s1");
  });

  it("uses the connection speech model instead of FISH_TTS_MODEL", async () => {
    vi.stubEnv("FISH_TTS_MODEL", "s1");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    await new FishAudioVoiceProvider().synthesize(
      { text: "Hi", voiceId: "voice-id", apiKey: "sk-test", model: "s2-pro" },
      ctx,
    );
    await new FishAudioVoiceProvider().synthesize(
      { text: "Hi", voiceId: "voice-id", apiKey: "sk-other", model: "s1" },
      ctx,
    );

    const headers = (call: number) => {
      const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
      return (init?.headers ?? {}) as Record<string, string>;
    };
    expect(headers(0).model).toBe("s2-pro");
    expect(headers(1).model).toBe("s1");
  });

  it("ignores a connection speech model that is not a model id", async () => {
    vi.stubEnv("FISH_TTS_MODEL", "s1");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    await new FishAudioVoiceProvider().synthesize(
      { text: "Hi", voiceId: "voice-id", apiKey: "sk-test", model: "s2\ninjected" },
      ctx,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).model).toBe("s1");
  });

  it("keeps s2.1-pro when FISH_TTS_MODEL is not a model id", async () => {
    vi.stubEnv("FISH_TTS_MODEL", "s1\ninjected");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    await new FishAudioVoiceProvider().synthesize(
      { text: "Hi", voiceId: "voice-id", apiKey: "sk-test" },
      ctx,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).model).toBe("s2.1-pro");
  });

  it("logs the upstream Fish status and message without the API key", async () => {
    const apiKey = "sk-fishaudiokey12345";
    const sink = createTestSink();
    installLogger(createLogger({ service: "rakazo-api", sinks: [sink] }));
    vi.stubEnv("FISH_TTS_MODEL", "s1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: `model s1 is not enabled for ${apiKey}`,
            status: 502,
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const error = await new FishAudioVoiceProvider()
      .synthesize({ text: "Hi", voiceId: "voice-id", apiKey }, ctx)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "speaking failed: model s1 is not enabled for [Redacted]",
    );
    expect((error as Error).message).not.toContain(apiKey);

    const event = sink.events.find((entry) => entry.message === "Fish Audio request failed");
    expect(event).toMatchObject({
      provider: "fish-audio",
      operation: "speaking",
      "http.status": 502,
      "fish.model": "s1",
      "error.detail": "model s1 is not enabled for [Redacted]",
    });
    expect(JSON.stringify(event)).not.toContain(apiKey);
  });

  it.each([
    [
      "speaking",
      (provider: FishAudioVoiceProvider) =>
        provider.synthesize({ text: "Hi", voiceId: "voice-id", apiKey: "sk-test" }, ctx),
    ],
    [
      "transcribing",
      (provider: FishAudioVoiceProvider) =>
        provider.transcribe!(
          { audio: new Uint8Array([1]), mimeType: "audio/webm", apiKey: "sk-test" },
          ctx,
        ),
    ],
    ["listing voices", (provider: FishAudioVoiceProvider) => provider.listVoices("sk-test", ctx)],
  ])("logs Fish %s status when the error body cannot be read", async (operation, call) => {
    const sink = createTestSink();
    installLogger(createLogger({ service: "rakazo-api", sinks: [sink] }));
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Response(new ReadableStream({ cancel }), {
            status: 502,
            headers: { "content-length": String(MAX_VOICE_JSON_BYTES + 1) },
          }),
      ),
    );

    await expect(call(new FishAudioVoiceProvider())).rejects.toThrow(
      `${operation} failed: Voice response is too large.`,
    );

    const event = sink.events.find((entry) => entry.message === "Fish Audio request failed");
    expect(event).toMatchObject({
      operation,
      "http.status": 502,
      "error.detail": "Voice response is too large.",
    });
    expect(cancel).toHaveBeenCalled();
  });

  it("logs a non-JSON Fish body when speaking fails", async () => {
    const apiKey = "sk-fishaudiokey12345";
    const sink = createTestSink();
    installLogger(createLogger({ service: "rakazo-api", sinks: [sink] }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(`gateway down ${apiKey}`, { status: 502 })),
    );

    await expect(
      new FishAudioVoiceProvider().synthesize({ text: "Hi", voiceId: "voice-id", apiKey }, ctx),
    ).rejects.toThrow("speaking failed (502)");

    const event = sink.events.find((entry) => entry.message === "Fish Audio request failed");
    expect(event).toMatchObject({
      "http.status": 502,
      "error.detail": "gateway down [Redacted]",
      "fish.model": "s2.1-pro",
    });
    expect(JSON.stringify(event)).not.toContain(apiKey);
  });

  it("transcribes through Fish Audio ASR", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hello" })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new FishAudioVoiceProvider().transcribe!(
        { audio: new Uint8Array([1]), mimeType: "audio/ogg;codecs=opus", apiKey: "sk-test" },
        ctx,
      ),
    ).resolves.toEqual({ text: "hello" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.fish.audio/v1/asr");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = init.body as FormData;
    expect((form.get("audio") as File).name).toBe("speech.ogg");
    expect(form.get("ignore_timestamps")).toBe("true");
  });
});

describe("KokoroVoiceProvider", () => {
  it("maps voices from { voices } payloads and prefers af_heart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            voices: [
              { id: "am_adam", name: "am_adam" },
              { id: "af_heart", name: "af_heart", overall_grade: "A" },
            ],
          }),
        ),
      ),
    );
    const provider = new KokoroVoiceProvider();
    const voices = await provider.listVoices("kokoro-local", ctx);
    expect(voices[0]?.id).toBe("af_heart");
    expect(voices.some((voice) => voice.id === "am_adam")).toBe(true);
  });

  it("posts speech to /audio/speech with model kokoro", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([7, 8]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    const clip = await new KokoroVoiceProvider().synthesize(
      { text: "Hi", voiceId: "af_heart", apiKey: "kokoro-local" },
      ctx,
    );
    expect([...clip.bytes]).toEqual([7, 8]);
    expect(clip.mimeType).toBe("audio/mpeg");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/audio/speech");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(body.model).toBe("kokoro");
    expect(body.voice).toBe("af_heart");
    expect(body.response_format).toBe("mp3");
  });

  it("verifies against /models without requiring a real key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new KokoroVoiceProvider().verify("kokoro-local", ctx)).resolves.toEqual({
      ok: true,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/models");
  });
});

describe("MiniMaxVoiceProvider", () => {
  const minimaxOk = (extra: object) =>
    new Response(
      JSON.stringify({ base_resp: { status_code: 0, status_msg: "success" }, ...extra }),
    );

  it("lists system voices from get_voice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      minimaxOk({
        system_voice: [
          {
            voice_id: "English_expressive_narrator",
            voice_name: "Narrator",
            description: ["Warm"],
          },
          { voice_name: "no id" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const voices = await new MiniMaxVoiceProvider().listVoices("mm-key", ctx);
    expect(voices).toEqual([
      { id: "English_expressive_narrator", label: "Narrator", description: "Warm" },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/get_voice");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      voice_type: "system",
    });
  });

  it("decodes hex audio from t2a_v2", async () => {
    const fetchMock = vi.fn().mockResolvedValue(minimaxOk({ data: { audio: "0a0bff" } }));
    vi.stubGlobal("fetch", fetchMock);
    const clip = await new MiniMaxVoiceProvider().synthesize(
      { text: "Hi", voiceId: "English_expressive_narrator", apiKey: "mm-key" },
      ctx,
    );
    expect([...clip.bytes]).toEqual([10, 11, 255]);
    expect(clip.mimeType).toBe("audio/mpeg");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/t2a_v2");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.output_format).toBe("hex");
    expect(body.voice_setting.voice_id).toBe("English_expressive_narrator");
  });

  it("treats an HTTP 200 with a failing base_resp as an error", async () => {
    const failing = () =>
      new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: "login fail" } }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => failing()),
    );
    await expect(new MiniMaxVoiceProvider().verify("bad", ctx)).resolves.toEqual({
      ok: false,
      message: "MiniMax rejected that key. Check the key and that it has speech permissions.",
    });
    await expect(
      new MiniMaxVoiceProvider().synthesize({ text: "Hi", voiceId: "v", apiKey: "bad" }, ctx),
    ).rejects.toThrow(/rejected that key/);
  });

  it("rejects a response with no audio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(minimaxOk({ data: { audio: "" } })));
    await expect(
      new MiniMaxVoiceProvider().synthesize({ text: "Hi", voiceId: "v", apiKey: "k" }, ctx),
    ).rejects.toThrow("MiniMax returned no audio.");
  });
});

describe("TelnyxVoiceProvider", () => {
  it("verifies against /balance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(new TelnyxVoiceProvider().verify("KEY_test", ctx)).resolves.toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.telnyx.com/v2/balance");
  });

  it("offers dot-separated provider voice ids without a network round trip", async () => {
    const voices = await new TelnyxVoiceProvider().listVoices("KEY_test", ctx);
    expect(voices.every((voice) => voice.id.split(".").length >= 2)).toBe(true);
  });

  it("posts binary speech to /text-to-speech/speech", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([3, 4]), { headers: { "content-type": "audio/mpeg" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const clip = await new TelnyxVoiceProvider().synthesize(
      { text: "Hi", voiceId: "Telnyx.KokoroTTS.af", apiKey: "KEY_test" },
      ctx,
    );
    expect([...clip.bytes]).toEqual([3, 4]);
    expect(clip.mimeType).toBe("audio/mpeg");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/text-to-speech/speech");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      text: "Hi",
      voice: "Telnyx.KokoroTTS.af",
      output_type: "binary_output",
    });
  });

  it("transcribes through /ai/audio/transcriptions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: " hi " })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new TelnyxVoiceProvider().transcribe!(
        { audio: new Uint8Array([1]), mimeType: "audio/webm", apiKey: "KEY_test" },
        ctx,
      ),
    ).resolves.toEqual({ text: "hi" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/ai/audio/transcriptions");
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("model")).toBe("openai/whisper-large-v3-turbo");
  });
});

describe("hosted voice response limits", () => {
  it.each([
    ["ElevenLabs", () => new ElevenLabsVoiceProvider(), "voice"],
    ["OpenAI", () => new OpenAIVoiceProvider(), "alloy"],
    ["Cartesia", () => new CartesiaVoiceProvider(), "sonic"],
    ["Kokoro", () => new KokoroVoiceProvider(), "af_heart"],
    ["Fish Audio", () => new FishAudioVoiceProvider(), "voice"],
    ["MiniMax", () => new MiniMaxVoiceProvider(), "English_expressive_narrator"],
    ["Telnyx", () => new TelnyxVoiceProvider(), "Telnyx.KokoroTTS.af"],
  ])(
    "rejects an oversized %s speech response before buffering it",
    async (_name, create, voiceId) => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({
            "content-length": String(MAX_SYNTHESIZED_AUDIO_BYTES + 1),
          }),
          body: { cancel },
        }),
      );

      await expect(
        create().synthesize({ text: "Hi", voiceId, apiKey: "sk-test" }, ctx),
      ).rejects.toThrow("Voice response is too large.");
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});

describe("ScriptedVoiceProvider", () => {
  it("verifies, lists, speaks, and transcribes without a network", async () => {
    const provider = new ScriptedVoiceProvider();
    await expect(provider.verify("short", ctx)).resolves.toEqual({
      ok: false,
      message: "That key is too short.",
    });
    await expect(provider.verify("fake-scripted-voice-key", ctx)).resolves.toEqual({ ok: true });
    expect(await provider.listVoices("fake-scripted-voice-key", ctx)).toEqual([
      { id: SCRIPTED_VOICE_ID, label: "Scripted", description: "Test voice" },
    ]);
    const clip = await provider.synthesize(
      { text: "Hello", voiceId: SCRIPTED_VOICE_ID, apiKey: "fake-scripted-voice-key" },
      ctx,
    );
    expect(clip.mimeType).toBe("audio/mpeg");
    expect([...clip.bytes]).toEqual([...SCRIPTED_MPEG]);
    await expect(
      provider.transcribe(
        {
          audio: new Uint8Array([1]),
          mimeType: "audio/webm",
          apiKey: "fake-scripted-voice-key",
        },
        ctx,
      ),
    ).resolves.toEqual({ text: SCRIPTED_TRANSCRIPT });
  });
});

describe("VoiceStudioVoiceProvider", () => {
  it("keeps the bearer key server-side for capability verification", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ protocol: "voicestudio.speech.v1" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new VoiceStudioVoiceProvider().verify("private-key", ctx)).resolves.toEqual({
      ok: true,
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer private-key",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("private-key");
  });

  it("uses the local Kokoro bridge for speech", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);
    const clip = await new VoiceStudioVoiceProvider().synthesize(
      { text: "Hello", voiceId: "af_heart", apiKey: "private-key" },
      ctx,
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      model: "kokoro",
      voice: "af_heart",
      response_format: "mp3",
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("kokoro.getbijou.xyz");
    expect([...clip.bytes]).toEqual([1, 2, 3]);
  });

  it("uses the pinned multilingual model for batch fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hello" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new VoiceStudioVoiceProvider().transcribe!(
        {
          audio: new Uint8Array([1]),
          mimeType: "audio/webm",
          apiKey: "private-key",
        },
        ctx,
      ),
    ).resolves.toEqual({ text: "hello" });
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("model")).toBe("sherpa-whisper-tiny");
  });

  it("surfaces auth failures without echoing the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "API key required" }), {
          status: 401,
        }),
      ),
    );
    await expect(
      new VoiceStudioVoiceProvider().transcribe!(
        {
          audio: new Uint8Array([1]),
          mimeType: "audio/webm",
          apiKey: "do-not-log",
        },
        ctx,
      ),
    ).rejects.not.toThrow(/do-not-log/);
  });
});
