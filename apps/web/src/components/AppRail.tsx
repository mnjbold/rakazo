import { useLingui } from "@lingui/react/macro";
import { BotAvatar, Tooltip, TooltipContent, TooltipTrigger } from "@rakazo/ui-web";
import { Bot, Code2 } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";

type AppRailProps = {
  active: "bots" | "artifacts";
  /** Rendered above the section links (the bots sidebar toggle). */
  top?: ReactNode;
  /** Phones reach bots from the full-width list instead. */
  hideOnPhone?: boolean;
  children?: ReactNode;
};

export function AppRail({ active, top, hideOnPhone = false, children }: AppRailProps) {
  const { t } = useLingui();
  return (
    <nav
      data-testid="app-rail"
      aria-label={t`Sections`}
      className={`relative z-20 w-14 shrink-0 flex-col items-center gap-1 border-e border-sidebar-border bg-sidebar pt-3 ${
        hideOnPhone ? "hidden md:flex" : "flex"
      }`}
    >
      {top}
      <RailLink to="/app" label={t`Bots`} active={active === "bots"}>
        <Bot size={19} strokeWidth={1.75} />
      </RailLink>
      <RailLink to="/app/artifacts" label={t`Artifacts`} active={active === "artifacts"}>
        <Code2 size={19} strokeWidth={1.75} />
      </RailLink>
      {children ? (
        <div
          data-testid="app-rail-bots"
          className="mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto border-t border-sidebar-border pt-2 pb-3 [scrollbar-width:none]"
        >
          {children}
        </div>
      ) : null}
    </nav>
  );
}

export function RailBot({
  id,
  name,
  color,
  status,
  unread,
  selected,
  onSelect,
  onContextMenu,
}: {
  id: string;
  name: string;
  color: string;
  status?: string;
  unread?: boolean;
  selected: boolean;
  onSelect: () => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        data-rail-bot-id={id}
        aria-label={name}
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        className={`relative flex size-10 shrink-0 items-center justify-center rounded-[11px] transition-colors ${
          selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
        }`}
      >
        <BotAvatar color={color} identity={id} size={30} status={status} />
        {unread ? (
          <span
            aria-hidden="true"
            className="absolute end-0.5 top-0.5 size-2.5 rounded-full border-2 border-sidebar bg-foreground"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipContent side="right">{name}</TooltipContent>
    </Tooltip>
  );
}

function RailLink({
  to,
  label,
  active,
  children,
}: {
  to: string;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
