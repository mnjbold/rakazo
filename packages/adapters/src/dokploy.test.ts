import { describe, expect, it } from "vitest";
import { RAKAZO_STAGING_LIMITS, redactDokployLog, validateStagingDomain } from "./dokploy.js";

describe("Dokploy staging policy", () => {
  it("pins resource limits", () =>
    expect(RAKAZO_STAGING_LIMITS).toEqual({ cpu: 2, memoryMb: 4096, diskGb: 20 }));
  it("accepts only delegated staging subdomains", () => {
    expect(validateStagingDomain("api.demo.staging.getbijou.xyz")).toBe(
      "api.demo.staging.getbijou.xyz",
    );
    expect(() => validateStagingDomain("getbijou.xyz")).toThrow(/staging domains/i);
    expect(() => validateStagingDomain("staging.getbijou.xyz")).toThrow(/staging domains/i);
  });
  it("redacts common secret forms from logs", () => {
    expect(redactDokployLog("token=abc password: nope ok")).toBe(
      "token=[redacted] password: [redacted] ok",
    );
  });
});
