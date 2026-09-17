import { Trans, useLingui } from "@lingui/react/macro";
import type {
  DokployDeployment,
  DokployFullStackPreview,
  DokployPreview,
  DokployServiceKind,
  DokployStatus,
} from "@rakazo/contracts";
import { Button, Field, FieldLabel, Input } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

export function DokploySection({ isDeploymentOwner }: { isDeploymentOwner: boolean }) {
  const { t } = useLingui();
  const [status, setStatus] = useState<DokployStatus | null>(null);
  const [kind, setKind] = useState<DokployServiceKind>("application");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [preview, setPreview] = useState<DokployPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [fullStack, setFullStack] = useState<DokployFullStackPreview | null>(null);
  const [deployments, setDeployments] = useState<DokployDeployment[]>([]);
  const [logs, setLogs] = useState("");

  useEffect(() => {
    if (!isDeploymentOwner) return;
    void rpc.dokploy
      .status()
      .then(setStatus)
      .catch((value) =>
        setError(value instanceof Error ? value.message : t`Could not load Dokploy status`),
      );
  }, [isDeploymentOwner, t]);
  if (!isDeploymentOwner || !status) return null;

  async function buildPreview() {
    setError(null);
    try {
      setPreview(
        await rpc.dokploy.preview({
          operation: "create",
          serviceKind: kind,
          name,
          domain: domain || null,
        }),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : t`Preview failed`);
    }
  }

  async function buildFullStackPreview() {
    setError(null);
    try {
      setFullStack(
        await rpc.dokploy.fullStackPreview({
          slug: name,
          compose,
          domain: domain || null,
          environmentKeys: [],
          volumes: [],
          databases: [],
        }),
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : t`Preview failed`);
    }
  }

  async function loadDeployments() {
    setError(null);
    try {
      setDeployments(await rpc.dokploy.deployments({ serviceKind: kind, serviceId }));
    } catch (value) {
      setError(value instanceof Error ? value.message : t`Could not load deployments`);
    }
  }

  async function inspectDeployment(deploymentId: string) {
    setError(null);
    try {
      setLogs((await rpc.dokploy.logs({ deploymentId })).logs);
    } catch (value) {
      setError(value instanceof Error ? value.message : t`Could not load logs`);
    }
  }

  async function rollback(deploymentId: string) {
    if (!window.confirm(t`Rollback to the selected deployment?`)) return;
    setError(null);
    try {
      await rpc.dokploy.rollback({ serviceKind: kind, serviceId, deploymentId, confirmed: true });
      await loadDeployments();
    } catch (value) {
      setError(value instanceof Error ? value.message : t`Rollback failed`);
    }
  }

  return (
    <section
      data-testid="dokploy-settings"
      className="mt-5 rounded-xl border border-border px-4 py-4"
    >
      <h3 className="text-[15px] font-medium text-foreground">Dokploy</h3>
      <p className="mt-2 text-[12.5px] text-muted-foreground/80">
        <Trans>Staging only: {status.projectName}, 2 CPU, 4 GB memory, 20 GB disk.</Trans>
      </p>
      {!status.configured ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          <Trans>Set DOKPLOY_URL and DOKPLOY_API_KEY on the server to enable operations.</Trans>
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>
            <Trans>Service name</Trans>
          </FieldLabel>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel>
            <Trans>Staging domain</Trans>
          </FieldLabel>
          <Input
            placeholder="app.staging.getbijou.xyz"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant={kind === "application" ? "default" : "secondary"}
          className="rounded-full"
          onClick={() => setKind("application")}
        >
          <Trans>Application</Trans>
        </Button>
        <Button
          variant={kind === "compose" ? "default" : "secondary"}
          className="rounded-full"
          onClick={() => setKind("compose")}
        >
          <Trans>Compose</Trans>
        </Button>
        <Button
          variant="secondary"
          className="rounded-full"
          disabled={!name}
          onClick={() => void buildPreview()}
        >
          <Trans>Preview</Trans>
        </Button>
      </div>
      {preview ? (
        <div className="mt-3 rounded-lg border border-border bg-card px-3 py-3 text-[12.5px]">
          <p>
            {preview.serviceKind}: {preview.name}
          </p>
          <p>{preview.domain ?? t`Private service`}</p>
          <p className="mt-1 text-muted-foreground">
            <Trans>Review required before any Dokploy change.</Trans>
          </p>
        </div>
      ) : null}
      <details className="mt-3 rounded-lg border border-border px-3 py-3">
        <summary className="cursor-pointer text-[13px]">
          <Trans>Full-stack Compose preview</Trans>
        </summary>
        <textarea
          className="mt-3 min-h-28 w-full rounded-md border border-border bg-background p-2 text-xs"
          placeholder="services:"
          value={compose}
          onChange={(event) => setCompose(event.target.value)}
        />
        <Button
          variant="secondary"
          className="mt-2 rounded-full"
          disabled={!name || !compose}
          onClick={() => void buildFullStackPreview()}
        >
          <Trans>Preview full stack</Trans>
        </Button>
        {fullStack ? (
          <ul className="mt-2 text-[12px] text-muted-foreground">
            {fullStack.steps.map((step) => (
              <li key={step.path}>
                {step.path}
                {step.secretFields.length ? ` (${step.secretFields.length} protected)` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
      {status.configured ? (
        <details className="mt-3 rounded-lg border border-border px-3 py-3">
          <summary className="cursor-pointer text-[13px]">
            <Trans>Deployments and rollback</Trans>
          </summary>
          <Input
            className="mt-3"
            placeholder="Dokploy service ID"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
          />
          <Button
            variant="secondary"
            className="mt-2 rounded-full"
            disabled={!serviceId}
            onClick={() => void loadDeployments()}
          >
            <Trans>Load deployments</Trans>
          </Button>
          <div className="mt-2 space-y-2">
            {deployments.map((deployment) => (
              <div key={deployment.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span>{deployment.status}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void inspectDeployment(deployment.id)}
                >
                  <Trans>Logs</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void rollback(deployment.id)}
                >
                  <Trans>Rollback</Trans>
                </Button>
              </div>
            ))}
          </div>
          {logs ? (
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-[11px]">
              {logs}
            </pre>
          ) : null}
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
