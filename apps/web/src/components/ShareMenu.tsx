import { Trans, useLingui } from "@lingui/react/macro";
import type { BotTemplateVisibility } from "@rakazo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import { Globe, Users } from "lucide-react";
import { useState } from "react";

/** Share to the marketplace for this space or everyone. */
export function ShareMenu({
  label,
  onShare,
}: {
  label: string;
  onShare: (visibility: BotTemplateVisibility) => Promise<unknown>;
}) {
  const { t } = useLingui();
  const [state, setState] = useState<"idle" | "busy" | "shared" | "error">("idle");

  async function share(visibility: BotTemplateVisibility) {
    setState("busy");
    try {
      await onShare(visibility);
      setState("shared");
    } catch {
      setState("error");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        disabled={state === "busy"}
        render={<Button type="button" variant="secondary" size="sm" className="rounded-full" />}
      >
        {state === "shared" ? (
          <Trans>Shared</Trans>
        ) : state === "error" ? (
          <Trans>Could not share</Trans>
        ) : (
          <Trans>Share</Trans>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem onClick={() => void share("space")}>
          <Users />
          {t`This space`}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void share("public")}>
          <Globe />
          {t`Everyone`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
