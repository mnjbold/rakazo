import { integrationMonogram } from "@rakazo/core";
import { cn } from "@rakazo/ui-web";
import { useState } from "react";

/** Catalog logo, or a monogram tile of the same size when the logo is missing or fails. */
export function IntegrationIcon({
  name,
  logo,
  className,
}: {
  name: string;
  logo?: string | null;
  className?: string;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const frame = cn("size-8 shrink-0 rounded-lg bg-accent", className);
  if (logo && logo !== failedLogo) {
    return (
      <img
        src={logo}
        alt=""
        loading="lazy"
        decoding="async"
        data-integration-icon="logo"
        onError={() => setFailedLogo(logo)}
        className={cn(frame, "object-contain p-1")}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-integration-icon="monogram"
      className={cn(frame, "grid place-items-center text-sm font-semibold text-foreground")}
    >
      {integrationMonogram(name)}
    </span>
  );
}
