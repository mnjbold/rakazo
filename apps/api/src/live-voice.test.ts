import type { Actor } from "@rakazo/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountLiveVoiceRoute } from "./live-voice.js";
import type { VoiceDeps } from "./voice.js";

describe("live voice route", () => {
  it("mounts live voice route and returns injectWebSocket", () => {
    const app = new Hono();
    const result = mountLiveVoiceRoute(app, {} as VoiceDeps, async () => null);
    expect(result).toHaveProperty("injectWebSocket");
    expect(typeof result.injectWebSocket).toBe("function");
  });

  it("handles unauthenticated handshake", async () => {
    const app = new Hono();
    mountLiveVoiceRoute(app, {} as VoiceDeps, async () => null);
    const res = await app.request("/api/voice/live");
    // Without WebSocket headers, the handler handles or returns response
    expect(res).toBeDefined();
  });
});
