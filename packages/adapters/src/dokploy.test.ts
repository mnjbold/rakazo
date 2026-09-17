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

import { planDokployFullStack } from "./dokploy.js";

describe("Dokploy full-stack plans", () => {
  it("plans project, database, compose, volumes, and protected environment without executing", () => {
    const plan = planDokployFullStack({
      slug: "notes-app",
      compose: "services:\n  web:\n    image: example/web\n",
      domain: "notes.staging.getbijou.xyz",
      environment: { DATABASE_URL: "postgres://db", SESSION_SECRET: "hidden" },
      volumes: ["uploads"],
      databases: [{ kind: "postgres", name: "notes-db" }],
    });
    expect(plan.map((step) => step.path)).toEqual([
      "project.create",
      "environment.create",
      "postgres.create",
      "compose.create",
      "compose.saveEnvironment",
    ]);
    expect(plan.at(-1)?.secretFields).toEqual(["SESSION_SECRET"]);
    expect(plan.every((step) => !step.destructive)).toBe(true);
  });
});
