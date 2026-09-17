import { Trans, useLingui } from "@lingui/react/macro";
import type { DokployPreview, DokployServiceKind, DokployStatus } from "@rakazo/contracts";
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
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
