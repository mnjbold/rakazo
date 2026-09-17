import { describe, expect, it } from "vitest";
import { dokployStatus, previewDokploy } from "./dokploy.js";

describe("Dokploy owner surface", () => {
  it("does not reveal credentials in status", () => {
    expect(dokployStatus({ baseUrl: "https://dokploy.test", apiKey: "secret" })).toEqual({
      configured: true,
      projectName: "rakazo-staging",
      domainSuffix: ".staging.getbijou.xyz",
      limits: { cpu: 2, memoryMb: 4096, diskGb: 20 },
    });
  });
  it("requires confirmation and normalizes delegated domains", () => {
    expect(
      previewDokploy({
        operation: "deploy",
        serviceKind: "application",
        name: "web",
        domain: "WEB.STAGING.GETBIJOU.XYZ.",
      }),
    ).toMatchObject({ domain: "web.staging.getbijou.xyz", requiresConfirmation: true });
  });
});
