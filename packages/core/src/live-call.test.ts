import { describe, expect, it } from "vitest";
import {
  isSilentReply,
  LIVE_CALL_INSTRUCTION,
  liveCallInstruction,
  SILENT_REPLY_TOKEN,
} from "./live-call.js";

describe("live call", () => {
  it("recognizes only the bare silent token", () => {
    expect(isSilentReply(SILENT_REPLY_TOKEN)).toBe(true);
    expect(isSilentReply("  NO_RESPONSE\n")).toBe(true);
    expect(isSilentReply("")).toBe(false);
    expect(isSilentReply("NO_RESPONSE but also this")).toBe(false);
    expect(isSilentReply("no_response")).toBe(false);
  });

  it("adds the instruction only for live runs", () => {
    expect(liveCallInstruction(true)).toBe(LIVE_CALL_INSTRUCTION);
    expect(liveCallInstruction(false)).toBeUndefined();
    expect(liveCallInstruction(undefined)).toBeUndefined();
    expect(LIVE_CALL_INSTRUCTION).toContain(`exactly ${SILENT_REPLY_TOKEN} and nothing else`);
  });
});
