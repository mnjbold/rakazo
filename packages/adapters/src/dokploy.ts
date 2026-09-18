const DEFAULT_TIMEOUT_MS = 30_000;

export type DokployRequest = {
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, string>;
  body?: unknown;
};

export type DokployClientConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
};

/** Server-only Dokploy API client. Credentials never enter URLs, logs, or returned values. */
export class DokployClient {
  constructor(private readonly config: DokployClientConfig) {}

  async request<T>(request: DokployRequest, signal?: AbortSignal): Promise<T> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/api/${request.path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(request.query ?? {}))
      url.searchParams.set(key, value);
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(url, {
      method: request.method ?? (request.body === undefined ? "GET" : "POST"),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: combined,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Dokploy ${request.path} failed (${response.status})`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

export const RAKAZO_STAGING_LIMITS = { cpu: 2, memoryMb: 4096, diskGb: 20 } as const;
export const RAKAZO_STAGING_PROJECT = "rakazo-staging";
export const RAKAZO_STAGING_DOMAIN_SUFFIX = ".staging.getbijou.xyz";

export function validateStagingDomain(domain: string): string {
  const value = domain.trim().toLowerCase().replace(/\.$/, "");
  if (
    !value.endsWith(RAKAZO_STAGING_DOMAIN_SUFFIX) ||
    value === RAKAZO_STAGING_DOMAIN_SUFFIX.slice(1)
  ) {
    throw new Error(`Staging domains must be beneath *${RAKAZO_STAGING_DOMAIN_SUFFIX}`);
  }
  return value;
}

export function redactDokployLog(text: string): string {
  return text
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*(?:bearer\s+)?)[^\s]+/gi, "$1[redacted]")
    .slice(-20_000);
}

export type DokployFullStackSpec = {
  slug: string;
  compose: string;
  domain?: string | null;
  environment: Record<string, string>;
  volumes: string[];
  databases: Array<{ kind: "postgres" | "mysql" | "mariadb" | "mongo" | "redis"; name: string }>;
};

export type DokployPlanStep = {
  path: string;
  body: Record<string, unknown>;
  destructive: boolean;
  secretFields: string[];
};

/** Builds a reviewable plan only. Calling this never changes Dokploy. */
export function planDokployFullStack(spec: DokployFullStackSpec): DokployPlanStep[] {
  const slug = spec.slug.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(slug)) throw new Error("Invalid staging service slug");
  const domain = spec.domain ? validateStagingDomain(spec.domain) : null;
  if (Buffer.byteLength(spec.compose, "utf8") > 256_000)
    throw new Error("Compose file is too large");
  const volumeNames = spec.volumes.map((value) => value.trim());
  if (volumeNames.some((value) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(value))) {
    throw new Error("Invalid volume name");
  }
  const secretFields = Object.keys(spec.environment).filter((key) =>
    /key|token|password|secret/i.test(key),
  );
  return [
    {
      path: "project.create",
      body: { name: RAKAZO_STAGING_PROJECT },
      destructive: false,
      secretFields: [],
    },
    {
      path: "environment.create",
      body: { name: "staging", projectName: RAKAZO_STAGING_PROJECT },
      destructive: false,
      secretFields: [],
    },
    ...spec.databases.map((database) => ({
      path: `${database.kind}.create`,
      body: {
        name: database.name,
        projectName: RAKAZO_STAGING_PROJECT,
        cpuLimit: RAKAZO_STAGING_LIMITS.cpu,
        memoryLimit: RAKAZO_STAGING_LIMITS.memoryMb,
      },
      destructive: false,
      secretFields: [],
    })),
    {
      path: "compose.create",
      body: {
        name: slug,
        composeFile: spec.compose,
        projectName: RAKAZO_STAGING_PROJECT,
        domain,
        volumes: volumeNames,
        cpuLimit: RAKAZO_STAGING_LIMITS.cpu,
        memoryLimit: RAKAZO_STAGING_LIMITS.memoryMb,
        diskLimitGb: RAKAZO_STAGING_LIMITS.diskGb,
      },
      destructive: false,
      secretFields: [],
    },
    {
      path: "compose.saveEnvironment",
      body: { name: slug, environment: spec.environment },
      destructive: false,
      secretFields,
    },
  ];
}

export async function dokployDeploymentHistory(
  client: DokployClient,
  serviceKind: "application" | "compose",
  serviceId: string,
  signal?: AbortSignal,
) {
  const query: Record<string, string> =
    serviceKind === "compose" ? { composeId: serviceId } : { applicationId: serviceId };
  return client.request<unknown[]>(
    { path: `deployment.allBy${serviceKind === "compose" ? "Compose" : "Application"}`, query },
    signal,
  );
}

export async function dokployDeploymentLogs(
  client: DokployClient,
  deploymentId: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await client.request<unknown>(
    { path: "deployment.readLogs", query: { deploymentId } },
    signal,
  );
  return redactDokployLog(typeof result === "string" ? result : JSON.stringify(result));
}

export async function rollbackDokployDeployment(
  client: DokployClient,
  serviceKind: "application" | "compose",
  serviceId: string,
  deploymentId: string,
  signal?: AbortSignal,
) {
  if (!deploymentId.trim()) throw new Error("Select a deployment to rollback to");
  return client.request<Record<string, unknown>>(
    { path: `${serviceKind}.rollback`, body: { [`${serviceKind}Id`]: serviceId, deploymentId } },
    signal,
  );
}
