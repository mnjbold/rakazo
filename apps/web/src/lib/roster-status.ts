import { t } from "@lingui/core/macro";
import type { BotAttention } from "@rakazo/contracts";

/** Spoken after the bot name in its sidebar row; the avatar badge shows the same state. */
export function rosterAttentionLabel(attention: BotAttention | null | undefined): string | null {
  if (attention === "needs_you") return t`needs you`;
  if (attention === "error") return t`failed`;
  return null;
}

export function rosterHasUndismissedRunError(
  runErrorId: string | null | undefined,
  dismissedRunErrorIds: ReadonlySet<string>,
): boolean {
  return Boolean(runErrorId && !dismissedRunErrorIds.has(runErrorId));
}

/** Short sidebar label while a bot is queued, starting, or running. Null keeps the message preview. */
export function rosterWorkStatusLabel(status: string): string | null {
  switch (status) {
    case "queued":
      return t`Waiting in line…`;
    case "leased":
      return t`Starting…`;
    case "running":
      return t`Working…`;
    default:
      return null;
  }
}

/** Compact rows keep actionable status visible in place of the message preview. */
export function compactRosterStatusLabel(status: string): string | null {
  const workStatus = rosterWorkStatusLabel(status);
  if (workStatus) return workStatus;
  switch (status) {
    case "waiting_input":
      return t`Needs an answer`;
    case "waiting_takeover":
      return t`Needs you`;
    case "failed":
      return t`Error`;
    default:
      return null;
  }
}
