import type { ComputerMode } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "./client.js";

export type { ComputerMode } from "@rakazo/contracts";

export function parseComputerMode(scope: string): ComputerMode {
  if (scope === "team" || scope === "dedicated") return scope;
  throw new Error(`Unknown computer scope: ${scope}`);
}

export function computerScopeKey(mode: ComputerMode, spaceId: string, botId?: string) {
  if (mode === "team") return `team:${spaceId}`;
  if (!botId) throw new Error("Dedicated computers require a bot id");
  return `bot:${botId}`;
}

export function computerHomeKey(mode: ComputerMode, spaceId: string, botId?: string) {
  if (mode === "team") return `team-${spaceId}`;
  if (!botId) throw new Error("Dedicated computers require a bot id");
  return botId;
}

type ComputerDb = Pick<PrismaClient, "computer">;
type ExecutionLeaseDb = Pick<PrismaClient, "computerExecutionLease">;

/** Expire leases as fencing tombstones so the next acquire increments fence. */
export async function expireComputerExecutionLeases(
  prisma: ExecutionLeaseDb,
  where: Prisma.ComputerExecutionLeaseWhereInput,
): Promise<void> {
  await prisma.computerExecutionLease.updateMany({
    where,
    data: { expiresAt: new Date(0) },
  });
}

export async function ensureComputerRecord(
  prisma: ComputerDb,
  input: {
    mode: ComputerMode;
    spaceId: string;
    userId: string;
    botId?: string;
    kind: string;
  },
) {
  const scopeKey = computerScopeKey(input.mode, input.spaceId, input.botId);
  return prisma.computer.upsert({
    where: { scopeKey },
    create: {
      spaceId: input.spaceId,
      userId: input.userId,
      scope: input.mode,
      scopeKey,
      homeKey: computerHomeKey(input.mode, input.spaceId, input.botId),
      kind: input.kind,
    },
    update: {},
  });
}

/** Select a provider for one Private Computer. Team computers stay on the deployment default. */
export async function selectPrivateComputerProvider(
  prisma: Pick<PrismaClient, "computer">,
  input: { computerId: string; spaceId: string; userId: string; providerKind: "docker" | "box" },
) {
  const result = await prisma.computer.updateMany({
    where: {
      id: input.computerId,
      spaceId: input.spaceId,
      userId: input.userId,
      scope: "dedicated",
      state: "stopped",
      executionLeases: { none: { expiresAt: { gt: new Date() } } },
    },
    data: { desiredProviderKind: input.providerKind },
  });
  if (result.count !== 1) {
    throw new Error("Provider changes require an idle Private Computer owned by this user");
  }
  return { selected: input.providerKind };
}
