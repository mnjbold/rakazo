import type {
  Actor,
  Bot,
  BotTemplate,
  ComputerMode,
  CreateBotTemplateInput,
  UseBotTemplateInput,
} from "@rakazo/contracts";
import { IsolationError, type PrismaClient } from "@rakazo/db";

// The only bot fields a template may carry. Selecting them explicitly keeps
// secrets, connections, memory, history, and computers out of every snapshot.
const SHAREABLE_BOT_FIELDS = {
  name: true,
  title: true,
  description: true,
  instructions: true,
  color: true,
} as const;

// ponytail: newest 200 only; add cursor paging when a deployment outgrows it.
const LIST_LIMIT = 200;

type TemplateRow = {
  id: string;
  userId: string;
  visibility: string;
  name: string;
  title: string;
  description: string;
  instructions: string;
  color: string;
  createdAt: Date;
};

type CreateBot = (
  actor: Actor,
  input: {
    name: string;
    title: string;
    description: string;
    instructions: string;
    notifyOnFinish: boolean;
    color: string;
    computerMode: ComputerMode;
  },
) => Promise<Bot>;

function visibleTo(actor: Actor) {
  return { OR: [{ spaceId: actor.spaceId }, { visibility: "public" }] };
}

function mapTemplate(actor: Actor, row: TemplateRow): BotTemplate {
  return {
    id: row.id,
    visibility: row.visibility === "public" ? "public" : "space",
    name: row.name,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    color: row.color,
    mine: row.userId === actor.userId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createBotTemplatesService(
  prisma: Pick<PrismaClient, "bot" | "botTemplate">,
  createBot: CreateBot,
) {
  return {
    async list(actor: Actor) {
      const rows = await prisma.botTemplate.findMany({
        where: visibleTo(actor),
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
      });
      return rows.map((row) => mapTemplate(actor, row));
    },

    async create(actor: Actor, input: CreateBotTemplateInput) {
      // Same ownership scope as bots.update: only the bot's owner in this space.
      const bot = await prisma.bot.findFirst({
        where: {
          id: input.botId,
          spaceId: actor.spaceId,
          userId: actor.userId,
          archivedAt: null,
        },
        select: SHAREABLE_BOT_FIELDS,
      });
      if (!bot) throw new IsolationError();
      const row = await prisma.botTemplate.create({
        data: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          visibility: input.visibility,
          name: bot.name,
          title: bot.title,
          description: bot.description,
          instructions: bot.instructions,
          color: bot.color,
        },
      });
      return mapTemplate(actor, row);
    },

    async remove(actor: Actor, templateId: string) {
      const { count } = await prisma.botTemplate.deleteMany({
        where: { id: templateId, userId: actor.userId },
      });
      if (count === 0) throw new IsolationError();
      return { ok: true as const };
    },

    async use(actor: Actor, input: UseBotTemplateInput) {
      const template = await prisma.botTemplate.findFirst({
        where: { id: input.templateId, ...visibleTo(actor) },
      });
      if (!template) throw new IsolationError();
      return createBot(actor, {
        name: template.name,
        title: template.title,
        description: template.description,
        instructions: template.instructions,
        notifyOnFinish: true,
        color: template.color,
        computerMode: input.computerMode,
      });
    },
  };
}
