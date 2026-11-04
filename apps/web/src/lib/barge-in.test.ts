import { describe, expect, it } from "vitest";
import { BargeInDetector } from "./barge-in";

/** Feeds `ms` of a constant loudness; returns true if the detector fired at any point. */
function feed(detector: BargeInDetector, rms: number, ms: number): boolean {
  let fired = false;
  for (let t = 0; t < ms; t += 50) fired = detector.push(rms) || fired;
  return fired;
}

describe("BargeInDetector", () => {
  it("fires on sustained speech over a quiet room", () => {
    const detector = new BargeInDetector();
    expect(feed(detector, 0.01, 600)).toBe(false);
    expect(feed(detector, 0.2, 300)).toBe(true);
  });

  it("ignores a short noise like a cough or a door", () => {
    const detector = new BargeInDetector();
    feed(detector, 0.01, 600);
    expect(feed(detector, 0.3, 150)).toBe(false);
    expect(feed(detector, 0.01, 200)).toBe(false);
  });

  it("never fires during warm-up, even if the bot's own echo is loud", () => {
    const detector = new BargeInDetector();
    expect(feed(detector, 0.3, 400)).toBe(false);
  });

  it("adapts to steady background chatter and needs a clearly louder voice", () => {
    const detector = new BargeInDetector();
    expect(feed(detector, 0.06, 3000)).toBe(false);
    expect(feed(detector, 0.09, 600)).toBe(false);
    expect(feed(detector, 0.4, 300)).toBe(true);
  });
});
