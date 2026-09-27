import { Trans, useLingui } from "@lingui/react/macro";
import type { BotTemplate, MarketplaceItem } from "@rakazo/contracts";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@rakazo/ui-web";
import { Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

type Row = {
  id: string;
  name: string;
  description: string;
  mine: boolean;
  icon: ReactNode;
  action: ReactNode;
  onRemove: () => Promise<unknown>;
};

function Monogram({ name }: { name: string }) {
  return (
    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent font-semibold uppercase text-foreground">
      {name.trim().charAt(0) || "?"}
    </div>
  );
}

export function MarketplaceOverlay({
  onClose,
  onUseBotTemplate,
}: {
  onClose: () => void;
  onUseBotTemplate: (templateId: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const [templates, setTemplates] = useState<BotTemplate[]>([]);
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [credentialFor, setCredentialFor] = useState<string | null>(null);
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([rpc.botTemplates.list(), rpc.marketplace.list()])
      .then(([nextTemplates, nextItems]) => {
        if (cancelled) return;
        setTemplates(nextTemplates);
        setItems(nextItems);
      })
      .catch(() => {
        if (!cancelled) setError(t`Could not load`);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function run(id: string, action: () => Promise<unknown>) {
    if (pending) return;
    setPending(id);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t`Something went wrong`);
    } finally {
      setPending(null);
    }
  }

  async function install(item: MarketplaceItem) {
    if (item.needsCredential && credentialFor !== item.id) {
      setCredential("");
      setCredentialFor(item.id);
      return;
    }
    await run(item.id, async () => {
      await rpc.marketplace.install({
        itemId: item.id,
        credential: item.needsCredential ? credential.trim() : undefined,
      });
      setCredential("");
      setCredentialFor(null);
      setInstalled((current) => [...current, item.id]);
    });
  }

  const botRows: Row[] = templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.title || template.description,
    mine: template.mine,
    icon: <BotAvatar color={template.color} identity={template.id} size={36} />,
    action: (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="rounded-full"
        aria-label={t`Use template ${template.name}`}
        disabled={pending !== null}
        onClick={() => void run(template.id, () => onUseBotTemplate(template.id))}
      >
        <Trans>Use</Trans>
      </Button>
    ),
    onRemove: async () => {
      await rpc.botTemplates.remove({ templateId: template.id });
      setTemplates((current) => current.filter((row) => row.id !== template.id));
    },
  }));

  const itemRows = (kind: MarketplaceItem["kind"]): Row[] =>
    items
      .filter((item) => item.kind === kind)
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        mine: item.mine,
        icon: <Monogram name={item.name} />,
        action: (
          <div className="flex items-center gap-2">
            {credentialFor === item.id ? (
              <Input
                type="password"
                autoFocus
                aria-label={t`Credential for ${item.name}`}
                placeholder={t`Credential`}
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                className="h-8 w-44"
              />
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-full"
              aria-label={t`Install ${item.name}`}
              disabled={
                pending !== null ||
                installed.includes(item.id) ||
                (credentialFor === item.id && !credential.trim())
              }
              onClick={() => void install(item)}
            >
              {installed.includes(item.id) ? <Trans>Installed</Trans> : <Trans>Install</Trans>}
            </Button>
          </div>
        ),
        onRemove: async () => {
          await rpc.marketplace.remove({ itemId: item.id });
          setItems((current) => current.filter((row) => row.id !== item.id));
        },
      }));

  function list(rows: Row[]) {
    if (!rows.length) {
      return (
        <p className="px-3 py-6 text-muted-foreground">
          <Trans>Nothing shared yet</Trans>
        </p>
      );
    }
    return (
      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid={`marketplace-item-${row.id}`}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5"
          >
            {row.icon}
            <div className="min-w-0 flex-1">
              <div dir="auto" className="truncate text-[15px] font-medium text-foreground">
                {row.name}
              </div>
              <div dir="auto" className="truncate text-[13px] text-muted-foreground">
                {row.description}
              </div>
            </div>
            {row.mine ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t`Remove ${row.name}`}
                disabled={pending !== null}
                onClick={() => void run(row.id, row.onRemove)}
              >
                <Trash2 size={14} strokeWidth={1.8} />
              </Button>
            ) : null}
            {row.action}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="marketplace"
        className="flex h-[640px] max-h-[calc(100%-2rem)] w-[760px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[760px]"
      >
        <DialogHeader className="flex-row items-start justify-between px-8 pt-7">
          <DialogTitle className="text-2xl text-foreground">
            <Trans>Marketplace</Trans>
          </DialogTitle>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t`Close marketplace`} />}
          >
            <X />
          </DialogClose>
        </DialogHeader>
        {error ? (
          <p role="alert" className="px-8 pt-3 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
        <Tabs defaultValue="bots" className="min-h-0 flex-1 px-8 pt-4 pb-6">
          <TabsList aria-label={t`Marketplace`}>
            <TabsTrigger value="bots">
              <Trans>Bots</Trans>
            </TabsTrigger>
            <TabsTrigger value="skills">
              <Trans>Skills</Trans>
            </TabsTrigger>
            <TabsTrigger value="plugins">
              <Trans>Plugins</Trans>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="bots" className="mt-3 overflow-y-auto">
            {list(botRows)}
          </TabsContent>
          <TabsContent value="skills" className="mt-3 overflow-y-auto">
            {list(itemRows("skill"))}
          </TabsContent>
          <TabsContent value="plugins" className="mt-3 overflow-y-auto">
            {list(itemRows("plugin"))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
