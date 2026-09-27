import { ORPCError } from "@orpc/server";
import type {
  Actor,
  InstallMarketplaceItemInput,
  MarketplaceItem,
  MarketplacePluginConfig,
  ShareMarketplaceItemInput,
} from "@rakazo/contracts";
import { MarketplacePluginConfigSchema } from "@rakazo/contracts";
import { IsolationError, type Prisma, type PrismaClient } from "@rakazo/db";

// ponytail: newest 200 only; add cursor paging when a deployment outgrows it.
const LIST_LIMIT = 200;

type ItemRow = {
  id: string;
  userId: string;
  kind: string;
  visibility: string;
  name: string;
  description: string;
  content: string;
  config: unknown;
  createdAt: Date;
};

type InstallPlugin = (
  actor: Actor,
  input: {
    kind: "mcp" | "api";
    name: string;
    source: string;
    config: Record<string, unknown>;
    credential?: string;
  },
) => Promise<unknown>;
type CreateSkill = (actor: Actor, input: { content: string }) => Promise<unknown>;

/** Shared tool sources must be plain https URLs with no embedded userinfo. */
export function requireShareableUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Tool source URL is invalid" });
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ORPCError("BAD_REQUEST", { message: "Only https tool sources can be shared" });
  }
  return url.toString();
}

export function publicPluginConfig(row: {
  kind: string;
  source: string;
  config: unknown;
}): MarketplacePluginConfig {
  if (row.kind !== "mcp" && row.kind !== "api") {
    throw new ORPCError("BAD_REQUEST", { message: "Only MCP and API tool sources can be shared" });
  }
  const config = (row.config ?? {}) as Record<string, unknown>;
  const auth = MarketplacePluginConfigSchema.shape.auth.parse(config.auth ?? {});
  return MarketplacePluginConfigSchema.parse({
    kind: row.kind,
    source: requireShareableUrl(row.source),
    auth: auth.type === "header" || auth.type === "query" ? auth : { type: auth.type },
    ...(row.kind === "api" ? { operations: config.operations } : {}),
  });
}

function visibleTo(actor: Actor) {
  return { OR: [{ spaceId: actor.spaceId }, { visibility: "public" }] };
}

function mapItem(actor: Actor, row: ItemRow): MarketplaceItem {
  const plugin = row.kind === "plugin" ? MarketplacePluginConfigSchema.safeParse(row.config) : null;
  return {
    id: row.id,
    kind: row.kind === "plugin" ? "plugin" : "skill",
    visibility: row.visibility === "public" ? "public" : "space",
    name: row.name,
    description: row.description,
    needsCredential: Boolean(plugin?.success && plugin.data.auth.type !== "none"),
    mine: row.userId === actor.userId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createMarketplaceService(
  prisma: Pick<PrismaClient, "agentSkill" | "capabilityInstall" | "marketplaceItem">,
  deps: { createSkill: CreateSkill; installPlugin: InstallPlugin },
) {
  return {
    async list(actor: Actor) {
      const rows = await prisma.marketplaceItem.findMany({
        where: visibleTo(actor),
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
      });
      return rows.map((row) => mapItem(actor, row));
    },

    async share(actor: Actor, input: ShareMarketplaceItemInput) {
      const owner = { spaceId: actor.spaceId, userId: actor.userId };
      let data: Omit<
        Prisma.MarketplaceItemUncheckedCreateInput,
        "spaceId" | "userId" | "visibility"
      >;
      if (input.kind === "skill") {
        const skill = await prisma.agentSkill.findFirst({
          where: { id: input.skillId, ...owner, source: "user" },
          select: { name: true, description: true, content: true },
        });
        if (!skill) throw new IsolationError();
        data = { kind: "skill", ...skill };
      } else {
        const install = await prisma.capabilityInstall.findFirst({
          where: { id: input.installId, ...owner },
          select: { kind: true, name: true, source: true, config: true },
        });
        if (!install) throw new IsolationError();
        const config = publicPluginConfig(install);
        data = {
          kind: "plugin",
          name: install.name,
          description: config.source,
          config: config as Prisma.InputJsonValue,
        };
      }
      const row = await prisma.marketplaceItem.create({
        data: { ...owner, visibility: input.visibility, ...data },
      });
      return mapItem(actor, row);
    },

    async remove(actor: Actor, itemId: string) {
      const { count } = await prisma.marketplaceItem.deleteMany({
        where: { id: itemId, userId: actor.userId },
      });
      if (count === 0) throw new IsolationError();
      return { ok: true as const };
    },

    async install(actor: Actor, input: InstallMarketplaceItemInput) {
      const item = await prisma.marketplaceItem.findFirst({
        where: { id: input.itemId, ...visibleTo(actor) },
      });
      if (!item) throw new IsolationError();
      if (item.kind === "skill") {
        await deps.createSkill(actor, { content: item.content });
        return { ok: true as const };
      }
      const plugin = MarketplacePluginConfigSchema.parse(item.config);
      const auth = plugin.auth;
      await deps.installPlugin(actor, {
        kind: plugin.kind,
        name: item.name,
        source: requireShareableUrl(plugin.source),
        config:
          plugin.kind === "api"
            ? { auth, operations: plugin.operations ?? [] }
            : { preset: "custom", auth },
        credential: input.credential?.trim() || undefined,
      });
      return { ok: true as const };
    },
  };
}
