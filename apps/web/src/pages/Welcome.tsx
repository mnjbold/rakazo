import { Trans } from "@lingui/react/macro";
import { PRODUCT_MAKER, PRODUCT_MAKER_URL, PRODUCT_NAME } from "@rakazo/core";
import { JewlMark } from "@rakazo/ui-web";
import { useNavigate } from "react-router-dom";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col bg-background" data-rakazo-surface="welcome">
      <div className="app-drag flex gap-2 px-5 py-[18px]">
        <WindowChrome />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6 pb-[90px]">
        <div className="flex items-center gap-5 sm:gap-6">
          <JewlMark glow className="size-16 sm:size-[88px]" />
          <div className="text-[56px] font-semibold leading-none tracking-[-0.045em] text-foreground sm:text-[76px]">
            {PRODUCT_NAME}
          </div>
        </div>
        <p className="max-w-[560px] text-center text-[20px] leading-[1.45] text-foreground/70 sm:text-[24px]">
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
          {PRODUCT_NAME} by{" "}
          <a
            href={PRODUCT_MAKER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {PRODUCT_MAKER}
          </a>{" "}
          · forked from Rakazo
        </Trans>
      </p>
    </div>
  );
}
