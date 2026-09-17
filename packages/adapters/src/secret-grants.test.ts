import { describe, expect, it } from "vitest";
import {
  authorizeSecretGrant,
  mayConsumeSecretGrant,
  secretGrantExpiresAt,
} from "./secret-grants.js";

const base = {
  ownerUserId: "u",
  spaceId: "s",
  deliveryMode: "process" as const,
  providerKinds: ["docker", "box"],
  botId: "b",
  computerId: "c",
  allowedExecutable: "deploy",
  expiresAt: new Date("2030-01-01"),
};
const scope = {
  ownerUserId: "u",
  spaceId: "s",
  providerKind: "docker",
  botId: "b",
  computerId: "c",
  executable: "deploy",
};
describe("secret grants", () => {
  it("requires every bound scope", () => {
    expect(authorizeSecretGrant(base, scope, new Date("2029-01-01"))).toBe(true);
    for (const patch of [
      { ownerUserId: "x" },
      { spaceId: "x" },
      { botId: "x" },
      { computerId: "x" },
      { providerKind: "e2b" },
      { executable: "shell" },
    ])
      expect(authorizeSecretGrant(base, { ...scope, ...patch }, new Date("2029-01-01"))).toBe(
        false,
      );
  });
  it("expires and consumes once", () => {
    const now = new Date("2029-01-01");
    const expiresAt = secretGrantExpiresAt(now);
    expect(mayConsumeSecretGrant({ status: "issued", expiresAt }, now)).toBe(true);
    expect(mayConsumeSecretGrant({ status: "issued", expiresAt, consumedAt: now }, now)).toBe(
      false,
    );
    expect(mayConsumeSecretGrant({ status: "issued", expiresAt, revokedAt: now }, now)).toBe(false);
  });
  it("bounds TTL", () => {
    expect(() => secretGrantExpiresAt(new Date(), 999)).toThrow();
    expect(() => secretGrantExpiresAt(new Date(), 300001)).toThrow();
  });
});
