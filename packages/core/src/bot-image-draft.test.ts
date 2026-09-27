import { BOT_NAME_MAX_LENGTH, BOT_TITLE_MAX_LENGTH, BotImageDraftSchema } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { DEFAULT_GROK_BOT_COLOR } from "./bot-avatar-colors.js";
import { botImageDraftAvatar, parseBotImageDraft, sniffImageMimeType } from "./bot-image-draft.js";

describe("parseBotImageDraft", () => {
  it("maps a model draft to palette avatar and valid routines", () => {
    const draft = parseBotImageDraft(
      `Sure! ${JSON.stringify({
        name: "  Recruiter  ",
        title: "Screens\ncandidates",
        instructions: "You screen applicants.",
        color: "green",
        shape: "cloud",
        routines: [
          { name: "Inbox", prompt: "Check new applications.", cron: "0 9 * * 1-5" },
          { name: "Too often", prompt: "x", cron: "* * * * *" },
          { name: "Once", prompt: "x", cron: "@once" },
          { name: "Bad", prompt: "x", cron: "not a cron" },
          { name: "", prompt: "x", cron: "0 * * * *" },
        ],
      })}`,
    );
    expect(draft).toEqual({
      name: "Recruiter",
      title: "Screens candidates",
      instructions: "You screen applicants.",
      color: "#10B981::shape_7",
      routines: [{ name: "Inbox", prompt: "Check new applications.", cron: "0 9 * * 1-5" }],
    });
    expect(BotImageDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("trims oversized fields and caps routines", () => {
    const routine = { name: "Watch", prompt: "p".repeat(5000), cron: "0 * * * *" };
    const draft = parseBotImageDraft(
      JSON.stringify({
        name: "n".repeat(500),
        title: "t".repeat(2000),
        instructions: 42,
        routines: [routine, routine, routine, routine, routine],
      }),
    );
    expect(draft?.name).toHaveLength(BOT_NAME_MAX_LENGTH);
    expect(draft?.title).toHaveLength(BOT_TITLE_MAX_LENGTH);
    expect(draft?.instructions).toBe("");
    expect(draft?.routines).toHaveLength(3);
    expect(draft?.routines[0]?.prompt).toHaveLength(1000);
    expect(BotImageDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("rejects output without JSON or a name", () => {
    expect(parseBotImageDraft(undefined)).toBeNull();
    expect(parseBotImageDraft("I cannot see the image.")).toBeNull();
    expect(parseBotImageDraft("{not json}")).toBeNull();
    expect(parseBotImageDraft(JSON.stringify({ name: "   ", title: "x" }))).toBeNull();
  });
});

describe("botImageDraftAvatar", () => {
  it("accepts palette hex, falls back for unknown colors and shapes", () => {
    expect(botImageDraftAvatar("#3b82f6", "wedge")).toBe("#3B82F6::shape_1");
    expect(botImageDraftAvatar("chartreuse", "star")).toBe(`${DEFAULT_GROK_BOT_COLOR}::shape_0`);
    expect(botImageDraftAvatar(undefined, 3)).toBe(`${DEFAULT_GROK_BOT_COLOR}::shape_0`);
  });
});

describe("sniffImageMimeType", () => {
  it("detects allowed image signatures", () => {
    expect(
      sniffImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    expect(sniffImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMimeType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffImageMimeType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageMimeType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
  });
});
