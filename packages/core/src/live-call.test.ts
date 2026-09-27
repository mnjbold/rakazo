import { describe, expect, it } from "vitest";
import {
  couldBeSilentReply,
  END_OF_TURN_SILENCE_MS,
  endOfTurnSilenceMs,
  isSilentReply,
  LIVE_CALL_INSTRUCTION,
  liveCallInstruction,
  liveInterruptionInstruction,
  SILENT_REPLY_TOKEN,
  TRAILING_OFF_SILENCE_MS,
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

  it("ends a turn fast unless it trails off", () => {
    expect(endOfTurnSilenceMs("What's the weather tomorrow")).toBe(END_OF_TURN_SILENCE_MS);
    expect(endOfTurnSilenceMs("Book the flight.")).toBe(END_OF_TURN_SILENCE_MS);
    expect(endOfTurnSilenceMs("I need the report and")).toBe(TRAILING_OFF_SILENCE_MS);
    expect(endOfTurnSilenceMs("Send it but")).toBe(TRAILING_OFF_SILENCE_MS);
    expect(endOfTurnSilenceMs("So, um...")).toBe(TRAILING_OFF_SILENCE_MS);
    expect(endOfTurnSilenceMs("Check the calendar, so")).toBe(TRAILING_OFF_SILENCE_MS);
    // A word that merely ends like a conjunction does not count.
    expect(endOfTurnSilenceMs("Call Brand")).toBe(END_OF_TURN_SILENCE_MS);
    expect(END_OF_TURN_SILENCE_MS).toBeLessThan(TRAILING_OFF_SILENCE_MS);
  });

  it("treats a stream as possibly silent only while it is a prefix of the token", () => {
    expect(couldBeSilentReply("")).toBe(true);
    expect(couldBeSilentReply("NO_RES")).toBe(true);
    expect(couldBeSilentReply("NO_RESPONSE")).toBe(true);
    expect(couldBeSilentReply("No,")).toBe(false);
    expect(couldBeSilentReply("NO_RESPONSE.")).toBe(false);
  });
});
