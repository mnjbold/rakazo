import { describe, expect, it } from "vitest";
import { CreateGroupInput, GROUP_MEMBER_MAX, UpdateGroupInput } from "./domain.js";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `bot-${index}`);

describe("group member limits", () => {
  it("accepts a whole-team group well past the old six-bot cap", () => {
    expect(UpdateGroupInput.safeParse({ groupId: "group-1", botIds: ids(13) }).success).toBe(true);
    expect(CreateGroupInput.safeParse({ name: "All Bots", botIds: ids(13) }).success).toBe(true);
  });

  it("still bounds the member count", () => {
    expect(
      UpdateGroupInput.safeParse({ groupId: "group-1", botIds: ids(GROUP_MEMBER_MAX) }).success,
    ).toBe(true);
    expect(
      UpdateGroupInput.safeParse({ groupId: "group-1", botIds: ids(GROUP_MEMBER_MAX + 1) }).success,
    ).toBe(false);
    expect(UpdateGroupInput.safeParse({ groupId: "group-1", botIds: ids(1) }).success).toBe(false);
  });
});
