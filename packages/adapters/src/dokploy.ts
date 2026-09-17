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
