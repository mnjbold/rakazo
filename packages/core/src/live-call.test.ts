import { describe, expect, it } from "vitest";
import {
  isSilentReply,
  LIVE_CALL_INSTRUCTION,
  liveCallInstruction,
  liveInterruptionInstruction,
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

  it("adds interruption guidance only for live runs that carry what was heard", () => {
    expect(liveInterruptionInstruction(true, "  Your flight leaves at nine. ")).toBe(
      `The person interrupted your previous reply; they heard only: "Your flight leaves at nine.". Don't repeat what they heard; address what they just said, then finish anything important they missed only if it still matters.`,
    );
    expect(liveInterruptionInstruction(false, "Your flight")).toBeUndefined();
    expect(liveInterruptionInstruction(true, "   ")).toBeUndefined();
    expect(liveInterruptionInstruction(true, null)).toBeUndefined();
    // Quoted as data so embedded quotes cannot end the quotation.
    expect(liveInterruptionInstruction(true, 'say "hi"')).toContain(String.raw`"say \"hi\""`);
  });
});
