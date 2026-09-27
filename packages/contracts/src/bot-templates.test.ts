import { describe, expect, it } from "vitest";
import { BotTemplateSchema, CreateBotTemplateInput, UseBotTemplateInput } from "./domain.js";
import { appContract } from "./rpc.js";

describe("bot template inputs", () => {
  it("accepts only space or public visibility", () => {
    expect(CreateBotTemplateInput.safeParse({ botId: "bot-1", visibility: "space" }).success).toBe(
      true,
    );
    expect(CreateBotTemplateInput.safeParse({ botId: "bot-1", visibility: "public" }).success).toBe(
      true,
    );
    expect(CreateBotTemplateInput.safeParse({ botId: "bot-1", visibility: "org" }).success).toBe(
      false,
    );
    expect(CreateBotTemplateInput.safeParse({ botId: "", visibility: "space" }).success).toBe(
      false,
    );
    expect(CreateBotTemplateInput.safeParse({ botId: "bot-1" }).success).toBe(false);
  });

  it("does not let callers supply template content when sharing", () => {
    const parsed = CreateBotTemplateInput.parse({
      botId: "bot-1",
      visibility: "space",
      instructions: "injected",
      userId: "someone-else",
    });
    expect(parsed).toEqual({ botId: "bot-1", visibility: "space" });
  });

  it("defaults use to a team computer and rejects unknown modes", () => {
    expect(UseBotTemplateInput.parse({ templateId: "template-1" })).toEqual({
      templateId: "template-1",
      computerMode: "team",
    });
    expect(
      UseBotTemplateInput.safeParse({ templateId: "template-1", computerMode: "shared" }).success,
    ).toBe(false);
    expect(UseBotTemplateInput.safeParse({ templateId: "" }).success).toBe(false);
  });

  it("exposes no secret-bearing fields on the wire", () => {
    expect(Object.keys(BotTemplateSchema.shape).sort()).toEqual(
      [
        "color",
        "createdAt",
        "description",
        "id",
        "instructions",
        "mine",
        "name",
        "title",
        "visibility",
      ].sort(),
    );
    expect(Object.keys(appContract.botTemplates).sort()).toEqual([
      "create",
      "list",
      "remove",
      "use",
    ]);
  });
});
