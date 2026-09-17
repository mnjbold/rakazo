import { ORPCError } from "@orpc/server";
import {
  DokployClient,
  RAKAZO_STAGING_DOMAIN_SUFFIX,
  RAKAZO_STAGING_LIMITS,
  RAKAZO_STAGING_PROJECT,
  redactDokployLog,
  validateStagingDomain,
} from "@rakazo/adapters";
import type { DokployServiceKind } from "@rakazo/contracts";

export type DokployConfig = { baseUrl?: string; apiKey?: string };

export function dokployStatus(config: DokployConfig) {
  return {
    configured: Boolean(config.baseUrl && config.apiKey),
    projectName: RAKAZO_STAGING_PROJECT,
    domainSuffix: RAKAZO_STAGING_DOMAIN_SUFFIX,
    limits: RAKAZO_STAGING_LIMITS,
  } as const;
}

export function previewDokploy(input: {
  operation: "create" | "deploy" | "redeploy" | "rollback";
  serviceKind: DokployServiceKind;
  name: string;
  domain?: string | null;
}) {
  return {
    ...input,
    domain: input.domain ? validateStagingDomain(input.domain) : null,
    projectName: RAKAZO_STAGING_PROJECT,
    limits: RAKAZO_STAGING_LIMITS,
    requiresConfirmation: true,
  } as const;
}

export async function operateDokploy(
  config: DokployConfig,
  input: {
    operation: "deploy" | "redeploy" | "rollback";
    serviceKind: DokployServiceKind;
    serviceId: string;
    healthUrl?: string | null;
  },
  signal?: AbortSignal,
) {
  if (!config.baseUrl || !config.apiKey)
    throw new ORPCError("PRECONDITION_FAILED", { message: "Dokploy is not configured" });
  const client = new DokployClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const prefix = input.serviceKind;
  if (input.operation === "rollback") {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Rollback requires a selected deployment preview; no automatic target is chosen",
    });
  }
  const result = await client.request<Record<string, unknown>>(
    { path: `${prefix}.${input.operation}`, body: { [`${prefix}Id`]: input.serviceId } },
    signal,
  );
  let healthy = true;
  if (input.healthUrl) {
    try {
      const response = await fetch(input.healthUrl, { signal: AbortSignal.timeout(15_000) });
      healthy = response.ok;
    } catch {
      healthy = false;
    }
  }
  const deploymentId = typeof result.deploymentId === "string" ? result.deploymentId : null;
  const status = healthy ? "submitted" : "health-check-failed";
  return {
    ok: healthy,
    operation: input.operation,
    deploymentId,
    status,
    healthUrl: input.healthUrl ?? null,
    logs: redactDokployLog(JSON.stringify(result)),
    rolledBack: false,
  } as const;
}
