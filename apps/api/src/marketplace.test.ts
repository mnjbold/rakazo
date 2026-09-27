import type { Actor } from "@rakazo/contracts";
import { IsolationError, type PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createMarketplaceService } from "./marketplace.js";

const owner: Actor = {
  spaceId: "space-1",
  userId: "owner",
  email: "owner@rakazo.test",
  isDeploymentOwner: false,
};
const teammate: Actor = { ...owner, userId: "teammate", email: "teammate@rakazo.test" };
const outsider: Actor = {
  ...owner,
  spaceId: "space-2",
  userId: "outsider",
  email: "outsider@rakazo.test",
};

const SECRET = "sk-live-super-secret-token-1234";

type Row = Record<string, unknown>;
type Where = Record<string, unknown> & { OR?: Where[] };

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) =>
    key === "OR" ? (value as Where[]).some((clause) => matches(row, clause)) : row[key] === value,
  );
}

function table(rows: Row[]) {
  return {
    findFirst: vi.fn(async ({ where, select }: { where: Where; select?: Record<string, true> }) => {
      const found = rows.find((row) => matches(row, where));
      if (!found || !select) return found ?? null;
      return Object.fromEntries(Object.keys(select).map((key) => [key, found[key]]));
    }),
    findMany: vi.fn(async ({ where }: { where: Where }) =>
      rows.filter((row) => matches(row, where)),
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `item-${rows.length + 1}`, createdAt: new Date(0), ...data };
      rows.push(row);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => {
      const index = rows.findIndex((row) => matches(row, where));
      if (index < 0) return { count: 0 };
      rows.splice(index, 1);
      return { count: 1 };
    }),
  };
}

function setup() {
  const skills: Row[] = [
    {
      id: "skill-1",
      spaceId: "space-1",
      userId: "owner",
      source: "user",
      name: "triage",
      description: "Sort the inbox",
      content: "---\nname: triage\ndescription: Sort the inbox\n---\nRead every email.",
    },
  ];
  const installs: Row[] = [
    {
      id: "mcp-1",
      spaceId: "space-1",
      userId: "owner",
      kind: "mcp",
      name: "Docs",
      source: "https://mcp.example.test/mcp",
      secretId: "secret-1",
      config: {
        preset: "custom",
        auth: { type: "bearer", token: SECRET },
        headers: { "x-team": "acme", authorization: `Bearer ${SECRET}` },
        clientSecret: SECRET,
      },
    },
    {
      id: "api-1",
      spaceId: "space-1",
      userId: "owner",
      kind: "api",
      name: "Weather",
      source: "https://api.example.test",
      secretId: "secret-2",
      config: {
        auth: { type: "header", name: "x-api-key", value: SECRET },
        headers: { "x-api-key": SECRET },
        operations: [{ id: "forecast", method: "GET", path: "/forecast" }],
      },
    },
    {
      id: "http-1",
      spaceId: "space-1",
      userId: "owner",
      kind: "mcp",
      name: "Plain",
      source: "http://mcp.example.test/mcp",
      config: { auth: { type: "none" } },
    },
  ];
  const items: Row[] = [];
  const marketplaceItem = table(items);
  const createSkill = vi.fn(async () => ({}));
  const installPlugin = vi.fn(async () => ({}));
  const service = createMarketplaceService(
    {
      agentSkill: table(skills),
      capabilityInstall: table(installs),
      marketplaceItem,
    } as unknown as PrismaClient,
    { createSkill, installPlugin },
  );
  return { service, items, marketplaceItem, createSkill, installPlugin };
}

describe("marketplace", () => {
  it("never stores or returns plugin secrets, even when the source has them", async () => {
    const { service, items } = setup();
    const mcp = await service.share(owner, {
      kind: "plugin",
      installId: "mcp-1",
      visibility: "public",
    });
    const api = await service.share(owner, {
      kind: "plugin",
      installId: "api-1",
      visibility: "public",
    });
    expect(mcp.needsCredential).toBe(true);
    expect(api.needsCredential).toBe(true);
    expect(JSON.stringify([items, mcp, api])).not.toMatch(/sk-live|secret|authorization|x-team/i);
    expect(items[0]?.config).toEqual({
      kind: "mcp",
      source: "https://mcp.example.test/mcp",
      auth: { type: "bearer" },
    });
    expect(items[1]?.config).toEqual({
      kind: "api",
      source: "https://api.example.test/",
      auth: { type: "header", name: "x-api-key" },
      operations: [{ id: "forecast", method: "GET", path: "/forecast" }],
    });
  });

  it("rejects non-https tool sources", async () => {
    const { service, marketplaceItem } = setup();
    await expect(
      service.share(owner, { kind: "plugin", installId: "http-1", visibility: "space" }),
    ).rejects.toThrow(/https/);
    expect(marketplaceItem.create).not.toHaveBeenCalled();
  });

  it("only lets the owner in the same space share a skill or plugin", async () => {
    const { service, marketplaceItem } = setup();
    await expect(
      service.share(teammate, { kind: "skill", skillId: "skill-1", visibility: "public" }),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(
      service.share(outsider, { kind: "plugin", installId: "mcp-1", visibility: "public" }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(marketplaceItem.create).not.toHaveBeenCalled();
  });

  it("shows space items to the space and public items to everyone", async () => {
    const { service } = setup();
    const spaceOnly = await service.share(owner, {
      kind: "skill",
      skillId: "skill-1",
      visibility: "space",
    });
    const shared = await service.share(owner, {
      kind: "plugin",
      installId: "mcp-1",
      visibility: "public",
    });
    const forTeammate = await service.list(teammate);
    expect(forTeammate.map((row) => row.id).sort()).toEqual([spaceOnly.id, shared.id].sort());
    expect(forTeammate.every((row) => !row.mine)).toBe(true);
    expect((await service.list(outsider)).map((row) => row.id)).toEqual([shared.id]);
    await expect(service.install(outsider, { itemId: spaceOnly.id })).rejects.toBeInstanceOf(
      IsolationError,
    );
  });

  it("only lets the owner remove an item", async () => {
    const { service, items } = setup();
    const shared = await service.share(owner, {
      kind: "skill",
      skillId: "skill-1",
      visibility: "public",
    });
    await expect(service.remove(teammate, shared.id)).rejects.toBeInstanceOf(IsolationError);
    await expect(service.remove(outsider, shared.id)).rejects.toBeInstanceOf(IsolationError);
    expect(items).toHaveLength(1);
    await expect(service.remove(owner, shared.id)).resolves.toEqual({ ok: true });
    expect(items).toHaveLength(0);
  });

  it("installs for the caller with the caller's own credential", async () => {
    const { service, createSkill, installPlugin } = setup();
    const skill = await service.share(owner, {
      kind: "skill",
      skillId: "skill-1",
      visibility: "public",
    });
    const plugin = await service.share(owner, {
      kind: "plugin",
      installId: "mcp-1",
      visibility: "public",
    });
    await service.install(outsider, { itemId: skill.id });
    await service.install(outsider, { itemId: plugin.id, credential: " mine " });
    expect(createSkill).toHaveBeenCalledWith(outsider, {
      content: "---\nname: triage\ndescription: Sort the inbox\n---\nRead every email.",
    });
    expect(installPlugin).toHaveBeenCalledWith(outsider, {
      kind: "mcp",
      name: "Docs",
      source: "https://mcp.example.test/mcp",
      config: { preset: "custom", auth: { type: "bearer" } },
      credential: "mine",
    });
  });

  it("refuses to install a plugin whose stored URL is not https", async () => {
    const { service, items, installPlugin } = setup();
    items.push({
      id: "tampered",
      spaceId: "space-1",
      userId: "owner",
      kind: "plugin",
      visibility: "public",
      name: "Tampered",
      description: "",
      content: "",
      config: { kind: "mcp", source: "http://169.254.169.254/", auth: { type: "none" } },
      createdAt: new Date(0),
    });
    await expect(service.install(outsider, { itemId: "tampered" })).rejects.toThrow(/https/);
    expect(installPlugin).not.toHaveBeenCalled();
  });
});
