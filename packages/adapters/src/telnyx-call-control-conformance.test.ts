import { describe, expect, it } from "vitest";
import { TelnyxCallControl } from "./telnyx-call-control.js";
import { TelnyxCallControlEmulator } from "./telnyx-call-control-emulator.js";

const NOW = 1_800_000_000_000;
const URL = "https://example.test/api/v1/phone/telnyx/webhook";

function setup() {
  const emulator = new TelnyxCallControlEmulator(() => NOW);
  const provider = new TelnyxCallControl({
    apiKey: "KEY_test",
    publicKey: emulator.publicKey,
    fetch: emulator.fetch,
    now: () => NOW,
  });
  return { emulator, provider };
}

describe("TelnyxCallControl against the emulator", () => {
  it("accepts a validly signed webhook and translates it", async () => {
    const { emulator, provider } = setup();
    const result = await provider.parseWebhook(
      emulator.webhook(URL, "call.initiated", {
        call_control_id: "call-1",
        direction: "incoming",
        from: "+15551230000",
        to: "+15559990000",
      }),
    );
    expect(result).toEqual({
      ok: true,
      event: {
        kind: "incoming",
        eventId: "evt-1",
        callId: "call-1",
        from: "+15551230000",
        to: "+15559990000",
      },
    });
  });

  it("rejects a tampered body", async () => {
    const { emulator, provider } = setup();
    const request = emulator.webhook(
      URL,
      "call.hangup",
      { call_control_id: "c" },
      { tamper: true },
    );
    await expect(provider.parseWebhook(request)).resolves.toEqual({ ok: false });
  });

  it("rejects a signature from another key", async () => {
    const { provider } = setup();
    const other = new TelnyxCallControlEmulator(() => NOW);
    const request = other.webhook(URL, "call.hangup", { call_control_id: "c" });
    await expect(provider.parseWebhook(request)).resolves.toEqual({ ok: false });
  });

  it("rejects stale and missing timestamps", async () => {
    const { emulator, provider } = setup();
    const stale = emulator.webhook(
      URL,
      "call.hangup",
      { call_control_id: "c" },
      { timestamp: NOW / 1000 - 301 },
    );
    await expect(provider.parseWebhook(stale)).resolves.toEqual({ ok: false });
    const unsigned = new Request(URL, { method: "POST", body: "{}" });
    await expect(provider.parseWebhook(unsigned)).resolves.toEqual({ ok: false });
  });

  it("only surfaces final transcripts", async () => {
    const { emulator, provider } = setup();
    const interim = await provider.parseWebhook(
      emulator.webhook(URL, "call.transcription", {
        call_control_id: "c",
        transcription_data: { is_final: false, transcript: "hel" },
      }),
    );
    expect(interim).toEqual({ ok: true, event: null });
    const final = await provider.parseWebhook(
      emulator.webhook(URL, "call.transcription", {
        call_control_id: "c",
        transcription_data: { is_final: true, transcript: " hello there " },
      }),
    );
    expect(final).toEqual({
      ok: true,
      event: { kind: "speech", eventId: "evt-2", callId: "c", text: "hello there" },
    });
  });

  it("ignores outbound call legs", async () => {
    const { emulator, provider } = setup();
    const result = await provider.parseWebhook(
      emulator.webhook(URL, "call.initiated", { call_control_id: "c", direction: "outgoing" }),
    );
    expect(result).toEqual({ ok: true, event: null });
  });

  it("sends call commands in the Call Control wire format", async () => {
    const { emulator, provider } = setup();
    await provider.answer("v2:call/1");
    await provider.speak("v2:call/1", "Hi");
    await provider.listen("v2:call/1");
    await provider.hangup("v2:call/1");
    expect(emulator.commands).toEqual([
      { callId: "v2:call/1", action: "answer", body: {} },
      {
        callId: "v2:call/1",
        action: "speak",
        body: { payload: "Hi", voice: "Telnyx.KokoroTTS.af" },
      },
      {
        callId: "v2:call/1",
        action: "transcription_start",
        body: { transcription_engine: "Telnyx", transcription_tracks: "inbound" },
      },
      { callId: "v2:call/1", action: "hangup", body: {} },
    ]);
  });

  it("refuses a malformed public key", () => {
    expect(() => new TelnyxCallControl({ apiKey: "k", publicKey: "short" })).toThrow(
      /TELNYX_PUBLIC_KEY/,
    );
  });
});
