import { Trans, useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { ChatSession, ThreadMessage } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo/ui-web";
import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { formatRelativeTime } from "../../lib/relative-time";
import { rpc } from "../../lib/rpc";

const headerButton =
  "app-no-drag grid h-[30px] w-[34px] place-items-center rounded-[9px] hover:bg-accent data-popup-open:bg-accent";

/** Header button listing a bot's archived chats; hidden until there is one. */
export function ChatHistoryMenu({
  sessions,
  onOpen,
}: {
  sessions: readonly ChatSession[];
  onOpen: (session: ChatSession) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  if (sessions.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label={t`Chat history`} title={t`Chat history`} className={headerButton}>
        <History size={18} strokeWidth={1.6} className="text-foreground/75" aria-hidden="true" />
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="end"
          aria-label={t`Chat history`}
          className="app-no-drag max-h-[min(420px,70vh)] w-[280px] gap-0 overflow-y-auto p-1"
        >
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen(session);
              }}
              className="flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-2 text-start text-[13.5px] hover:bg-accent"
            >
              <span className="min-w-0 truncate text-foreground" dir="auto">
                {session.title}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {formatRelativeTime(session.createdAt)}
              </span>
            </button>
          ))}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function messageText(message: ThreadMessage): string {
  return message.blocks
    .flatMap((block) => (block.kind === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();
}

async function loadSession(
  botId: string,
  sessionId: string,
  signal: AbortSignal,
): Promise<ThreadMessage[]> {
  const pages: ThreadMessage[][] = [];
  let before: number | undefined;
  do {
    const page = await rpc.threads.messages({ botId, sessionId, before }, { signal });
    pages.push(page.messages);
    before = page.olderCursor ?? undefined;
  } while (before !== undefined && !signal.aborted);
  return pages.reverse().flat();
}

/** View-only transcript of one archived chat. */
export function ChatSessionOverlay({
  botId,
  botName,
  session,
  onClose,
}: {
  botId: string;
  botName: string;
  session: ChatSession;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setMessages(null);
    setFailed(false);
    loadSession(botId, session.id, abort.signal)
      .then((loaded) => {
        if (!abort.signal.aborted) setMessages(loaded);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [botId, session.id, reloadKey]);

  const visible = (messages ?? []).flatMap((message) => {
    const text = messageText(message);
    return text && message.role !== "system" ? [{ message, text }] : [];
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="chat-session-view"
        showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 text-foreground ring-0 sm:max-w-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-sidebar-border px-[18px] py-3.5">
          <DialogTitle className="truncate text-[15.5px] font-medium text-foreground" dir="auto">
            {session.title || botName}
          </DialogTitle>
          <DialogClose aria-label={t`Close`} render={<Button variant="ghost" size="sm" />}>
            <Trans>Close</Trans>
          </DialogClose>
        </div>
        {failed ? (
          <div className="grid flex-1 place-items-center px-8 text-center text-[13.5px] text-muted-foreground/80">
            <div className="flex flex-col items-center gap-3">
              <Trans>Could not load this chat.</Trans>
              <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                <Trans>Retry now</Trans>
              </Button>
            </div>
          </div>
        ) : !messages ? (
          <div className="grid flex-1 place-items-center px-8 text-center text-[13.5px] text-muted-foreground/80">
            <Trans>Loading…</Trans>
          </div>
        ) : (
          <div
            data-testid="chat-session-transcript"
            className="rk-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-5 md:px-7 md:py-6"
          >
            {visible.map(({ message, text }) => {
              const mine = message.role === "user";
              return (
                <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[14.5px] leading-[1.5] text-foreground/90 ${
                      mine ? "bg-accent" : "bg-muted"
                    }`}
                    dir="auto"
                  >
                    <ChatMarkdown>{text}</ChatMarkdown>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-4 border-t border-sidebar-border px-[18px] py-3.5">
          <p className="text-[13.5px] text-muted-foreground/80">
            <Trans>This chat is view-only</Trans>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
