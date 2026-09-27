import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_VOICE_AUDIO_BYTES, Speaker, VOICE_RESPONSE_TIMEOUT_MS } from "./tts.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubSelectedSpace(id: string) {
  const store = new Map<string, string>([["rakazo:space-id", id]]);
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  return (next: string) => store.set("rakazo:space-id", next);
}

describe("Speaker", () => {
  it("interrupting before audio arrives leaves the speaker idle", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockImplementation(() => new Promise(() => undefined));
    const pending = speaker.speak("Hello there.", { messageId: "m1" });
    speaker.stop();
    await pending;
    expect(speaker.state.status).toBe("idle");
  });

  it("reports everything spoken so far while each utterance plays", async () => {
    const speaker = new Speaker();
    const internals = speaker as unknown as {
      prepare: () => Promise<string[]>;
      render: () => Promise<Blob>;
      play: () => Promise<boolean>;
    };
    vi.spyOn(internals, "prepare").mockResolvedValue(["One.", "Two.", "Three."]);
    vi.spyOn(internals, "render").mockResolvedValue(new Blob(["audio"]));
    vi.spyOn(internals, "play").mockResolvedValue(true);
    const heard: (string | undefined)[] = [];
    speaker.subscribe((state) => {
      if (state.status === "speaking") heard.push(state.heard);
    });
    await speaker.speak("One. Two. Three.", { messageId: "m1" });
    expect(heard).toEqual(["One.", "One. Two.", "One. Two. Three."]);
    expect(speaker.state.heard).toBeUndefined();
  });

  it("resolves with an error snapshot instead of rejecting", async () => {
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockRejectedValue(new Error("ElevenLabs rejected that key."));
    await expect(speaker.speak("Hi there.")).resolves.toBeUndefined();
    expect(speaker.state.error).toBe("ElevenLabs rejected that key.");
  });

  it("queues streamed utterances and fetches only the next one while one plays", async () => {
    const speaker = new Speaker();
    const internals = speaker as unknown as {
      render: (text: string) => Promise<Blob>;
      play: () => Promise<boolean>;
    };
    const rendered: string[] = [];
    vi.spyOn(internals, "render").mockImplementation(async (text) => {
      rendered.push(text);
      return new Blob([text]);
    });
    const plays: Array<(finished: boolean) => void> = [];
    vi.spyOn(internals, "play").mockImplementation(
      () => new Promise<boolean>((resolve) => plays.push(resolve)),
    );
    const heard: (string | undefined)[] = [];
    speaker.subscribe((state) => {
      if (state.status === "speaking") heard.push(state.heard);
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    speaker.enqueue(["One."], { messageId: "run:r1" });
    await settle();
    expect(rendered).toEqual(["One."]);
    expect(plays).toHaveLength(1);

    // Sentences that arrive mid-playback join the queue; only the next one is fetched early.
    speaker.enqueue(["Two.", "Three."], { messageId: "run:r1" });
    expect(rendered).toEqual(["One.", "Two."]);
    plays[0]?.(true);
    await settle();
    expect(rendered).toEqual(["One.", "Two.", "Three."]);
    expect(plays).toHaveLength(2);
    plays[1]?.(true);
    await settle();
    plays[2]?.(true);
    await settle();
    expect(speaker.state.status).toBe("idle");

    // A later batch of the same reply keeps what was already heard.
    speaker.enqueue(["Four."], { messageId: "run:r1" });
    await settle();
    expect(heard.at(-1)).toBe("One. Two. Three. Four.");

    // Another message replaces the queue and starts its own heard.
    speaker.enqueue(["Other."], { messageId: "m2" });
    await settle();
    expect(speaker.state).toMatchObject({ messageId: "m2", heard: "Other." });
    speaker.stop();
    expect(heard).toEqual([
      "One.",
      "One. Two.",
      "One. Two. Three.",
      "One. Two. Three. Four.",
      "Other.",
    ]);
  });

  it("keeps speak requests in the space where playback started", async () => {
    const changeSelectedSpace = stubSelectedSpace("space-support");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      blob: async () => new Blob(["audio"]),
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "Audio",
      class {
        src = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() {
          queueMicrotask(() => this.onended?.());
          return Promise.resolve();
        }
        pause() {}
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const speaker = new Speaker();
    const prepare = vi
      .spyOn(
        speaker as unknown as {
          prepare: (
            text: string,
            opts: unknown,
            signal: AbortSignal,
            spaceId: string | null,
          ) => Promise<string[]>;
        },
        "prepare",
      )
      .mockImplementation(async () => {
        changeSelectedSpace("space-other");
        return ["Hello."];
      });
    await speaker.speak("Hello.", { messageId: "m1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/voice/speak",
      expect.objectContaining({ credentials: "include" }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-rakazo-space-id")).toBe("space-support");
    expect(headers.get("content-type")).toBe("application/json");
    expect(prepare.mock.calls[0]?.[3]).toBe("space-support");
  });

  it("rejects oversized audio without waiting for response cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            headers: { "content-length": String(MAX_VOICE_AUDIO_BYTES + 1) },
          }),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockResolvedValue(["Hello."]);

    await expect(speaker.speak("Hello.")).resolves.toBeUndefined();

    expect(speaker.state.error).toBe("Voice response is too large.");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("times out while a voice response body is stalled", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              pull: () => new Promise<void>(() => undefined),
            }),
          ),
      ),
    );
    const speaker = new Speaker();
    vi.spyOn(
      speaker as unknown as { prepare: () => Promise<string[]> },
      "prepare",
    ).mockResolvedValue(["Hello."]);

    const pending = speaker.speak("Hello.");
    await vi.advanceTimersByTimeAsync(VOICE_RESPONSE_TIMEOUT_MS);
    await pending;

    expect(speaker.state.error).toBe("Voice request timed out.");
  });
});
