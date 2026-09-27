import { Trans } from "@lingui/react/macro";
import { PRODUCT_MAKER, PRODUCT_NAME } from "@rakazo/core";
import { useNavigate } from "react-router-dom";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col bg-background" data-rakazo-surface="welcome">
      <div className="app-drag flex gap-2 px-5 py-[18px]">
        <WindowChrome />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-11 pb-[90px]">
        <div className="flex items-center gap-[26px]">
          <div className="flex h-[88px] w-[88px] items-center justify-center gap-[13px] rounded-full bg-brand">
            <span className="h-6 w-[11px] rounded-full bg-background" />
            <span className="h-6 w-[11px] rounded-full bg-background" />
          </div>
          <div className="text-[76px] leading-none tracking-[-0.03em] text-foreground">
            {PRODUCT_NAME}
          </div>
        </div>
        <p className="max-w-[600px] text-center text-[27px] leading-[1.4] text-foreground/75">
          <Trans>
            Your team of always-on agents
            <br />
            that you can give real work to.
          </Trans>
        </p>
        <button
          type="button"
          onClick={() => navigate("/sign-up")}
          className="app-no-drag rounded-full bg-brand px-[34px] py-[15px] text-[19px] text-background transition hover:scale-[1.04]"
        >
          <Trans>Sign up</Trans>&nbsp;&nbsp;→
        </button>
      </div>
      <p className="pb-6 text-center text-[12px] text-muted-foreground">
        <Trans>
          {PRODUCT_NAME} by {PRODUCT_MAKER} · forked from Rakazo
        </Trans>
      </p>
    </div>
  );
}
