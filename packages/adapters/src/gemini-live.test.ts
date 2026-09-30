import { describe, expect, it } from "vitest";
import { GeminiLiveSession } from "./gemini-live.js";

describe("GeminiLiveSession", () => {
  it("instantiates cleanly with apiKey and config", () => {
    const session = new GeminiLiveSession("test-key-12345678", {
      voiceId: "Puck",
      systemInstruction: "You are a helpful assistant",
    });
    expect(session).toBeDefined();
  });

  it("handles sendAudio gracefully when not yet connected", () => {
    const session = new GeminiLiveSession("test-key", {});
    expect(() => session.sendAudio(new Uint8Array([1, 2, 3]))).not.toThrow();
    expect(() => session.sendAudioEnd()).not.toThrow();
    expect(() => session.close()).not.toThrow();
  });

  it("terminates async iterator when session is closed", async () => {
    const session = new GeminiLiveSession("test-key", {});
    session.close();
    const iterator = session.receive()[Symbol.asyncIterator]();
    const result = await iterator.next();
    expect(result.done).toBe(true);
  });
});
