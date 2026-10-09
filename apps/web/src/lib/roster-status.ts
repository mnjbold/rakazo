import { t } from "@lingui/core/macro";
import type { BotAttention } from "@rakazo/contracts";

/** Spoken after the bot name in its sidebar row; the avatar badge shows the same state. */
export function rosterAttentionLabel(attention: BotAttention | null | undefined): string | null {
  if (attention === "needs_you") return t`needs you`;
  if (attention === "error") return t`failed`;
  return null;
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
