import type { Actor, Bot } from "@rakazo/contracts";
import { IsolationError, type PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createBotTemplatesService } from "./bot-templates.js";

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

type Row = Record<string, unknown>;
type Where = Record<string, unknown> & { OR?: Where[] };

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) =>
    key === "OR" ? (value as Where[]).some((clause) => matches(row, clause)) : row[key] === value,
  );
}

function setup() {
  const bots: Row[] = [
    {
      id: "bot-1",
      spaceId: "space-1",
      userId: "owner",
      archivedAt: null,
      name: "Atlas",
      title: "Research lead",
      description: "Finds sources",
      instructions: "Cite every claim.",
      color: "#3EC5A8",
      webhookSecretId: "secret-1",
      computerId: "computer-1",
      memoryScope: "shared",
      modelProvider: "fake",
      modelId: "fake-model",
    },
  ];
  const templates: Row[] = [];
  const bot = {
    findFirst: vi.fn(async ({ where, select }: { where: Where; select: Record<string, true> }) => {
      const found = bots.find((row) => matches(row, where));
      if (!found) return null;
      return Object.fromEntries(Object.keys(select).map((key) => [key, found[key]]));
    }),
  };
  const botTemplate = {
    findMany: vi.fn(async ({ where }: { where: Where }) =>
      templates.filter((row) => matches(row, where)),
    ),
    findFirst: vi.fn(
      async ({ where }: { where: Where }) => templates.find((row) => matches(row, where)) ?? null,
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `template-${templates.length + 1}`, createdAt: new Date(0), ...data };
      templates.push(row);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => {
      const index = templates.findIndex((row) => matches(row, where));
      if (index < 0) return { count: 0 };
      templates.splice(index, 1);
      return { count: 1 };
    }),
  };
  const createBot = vi.fn(async (actor: Actor, input: { name: string }) => {
    return { id: "new-bot", spaceId: actor.spaceId, name: input.name } as Bot;
  });
  const service = createBotTemplatesService(
    { bot, botTemplate } as unknown as PrismaClient,
    createBot,
  );
  return { service, templates, botTemplate, createBot };
}

describe("bot templates", () => {
  it("snapshots only profile fields, never secrets, computers, memory, or models", async () => {
    const { service, templates } = setup();
    const template = await service.create(owner, { botId: "bot-1", visibility: "space" });
    expect(template).toMatchObject({
      name: "Atlas",
      title: "Research lead",
      instructions: "Cite every claim.",
      mine: true,
    });
    expect(Object.keys(templates[0]!).sort()).toEqual(
      [
        "color",
        "createdAt",
        "description",
        "id",
        "instructions",
        "name",
        "spaceId",
        "title",
        "userId",
        "visibility",
      ].sort(),
    );
    expect(JSON.stringify(templates[0])).not.toMatch(/secret|computer|memory|fake-model/);
  });

  it("only lets the bot owner in the same space share it", async () => {
    const { service, botTemplate } = setup();
    await expect(
      service.create(teammate, { botId: "bot-1", visibility: "public" }),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(
      service.create({ ...owner, spaceId: "space-2" }, { botId: "bot-1", visibility: "public" }),
    ).rejects.toBeInstanceOf(IsolationError);
    expect(botTemplate.create).not.toHaveBeenCalled();
  });

  it("shows space templates to the space and public templates to everyone", async () => {
    const { service } = setup();
    const spaceOnly = await service.create(owner, { botId: "bot-1", visibility: "space" });
    const shared = await service.create(owner, { botId: "bot-1", visibility: "public" });

    const forTeammate = await service.list(teammate);
    expect(forTeammate.map((row) => row.id).sort()).toEqual([spaceOnly.id, shared.id].sort());
    expect(forTeammate.every((row) => !row.mine)).toBe(true);
    expect((await service.list(outsider)).map((row) => row.id)).toEqual([shared.id]);

    await expect(
      service.use(outsider, { templateId: spaceOnly.id, computerMode: "team" }),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("only lets the owner remove a template", async () => {
    const { service, templates } = setup();
    const shared = await service.create(owner, { botId: "bot-1", visibility: "public" });
    await expect(service.remove(teammate, shared.id)).rejects.toBeInstanceOf(IsolationError);
    await expect(service.remove(outsider, shared.id)).rejects.toBeInstanceOf(IsolationError);
    expect(templates).toHaveLength(1);
    await expect(service.remove(owner, shared.id)).resolves.toEqual({ ok: true });
    expect(templates).toHaveLength(0);
  });

  it("creates a new bot owned by the caller through the standard create path", async () => {
    const { service, createBot } = setup();
    const shared = await service.create(owner, { botId: "bot-1", visibility: "public" });
    const bot = await service.use(outsider, { templateId: shared.id, computerMode: "dedicated" });
    expect(bot).toMatchObject({ id: "new-bot", spaceId: "space-2", name: "Atlas" });
    expect(createBot).toHaveBeenCalledWith(outsider, {
      name: "Atlas",
      title: "Research lead",
      description: "Finds sources",
      instructions: "Cite every claim.",
      notifyOnFinish: true,
      color: "#3EC5A8",
      computerMode: "dedicated",
    });
  });
});
