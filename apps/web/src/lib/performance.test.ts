import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  markAfterPaint,
  markEndOfSpeech,
  markOnce,
  measureReplyLatency,
  REPLY_LATENCY,
} from "./performance";

describe("performance marks", () => {
  beforeEach(() => {
    performance.clearMarks();
  });

  it("records a named mark only once", () => {
    markOnce("rk:test:once");
    markOnce("rk:test:once");

    expect(performance.getEntriesByName("rk:test:once")).toHaveLength(1);
  });

  it("records an after-paint mark after two animation frames", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });

    markAfterPaint("rk:test:painted");
    expect(performance.getEntriesByName("rk:test:painted")).toHaveLength(0);
    callbacks.shift()?.(1);
    expect(performance.getEntriesByName("rk:test:painted")).toHaveLength(0);
    callbacks.shift()?.(2);
    expect(performance.getEntriesByName("rk:test:painted")).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it("measures end of speech to first reply audio once per turn", () => {
    performance.clearMeasures();
    measureReplyLatency();
    expect(performance.getEntriesByName(REPLY_LATENCY)).toHaveLength(0);
    markEndOfSpeech();
    measureReplyLatency();
    measureReplyLatency();
    expect(performance.getEntriesByName(REPLY_LATENCY)).toHaveLength(1);
  });
});
