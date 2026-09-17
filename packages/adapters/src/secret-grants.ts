export type SecretGrantScope = {
  ownerUserId: string;
  spaceId: string;
  botId?: string | null;
  computerId?: string | null;
  providerKind: string;
  executable?: string | null;
  origin?: string | null;
};

export type SecretBindingPolicy = {
  ownerUserId: string;
  spaceId: string;
  botId?: string | null;
  computerId?: string | null;
  deliveryMode: "process" | "http" | "browser";
  providerKinds: string[];
  allowedExecutable?: string | null;
  destinationOrigin?: string | null;
  expiresAt?: Date | null;
};

export function authorizeSecretGrant(
  policy: SecretBindingPolicy,
  scope: SecretGrantScope,
  now = new Date(),
) {
  if (policy.ownerUserId !== scope.ownerUserId || policy.spaceId !== scope.spaceId) return false;
  if (policy.botId && policy.botId !== scope.botId) return false;
  if (policy.computerId && policy.computerId !== scope.computerId) return false;
  if (policy.expiresAt && policy.expiresAt <= now) return false;
  if (!policy.providerKinds.includes(scope.providerKind)) return false;
  if (policy.allowedExecutable && policy.allowedExecutable !== scope.executable) return false;
  if (policy.destinationOrigin) {
    if (!scope.origin) return false;
    try {
      if (new URL(scope.origin).origin !== new URL(policy.destinationOrigin).origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function secretGrantExpiresAt(now = new Date(), ttlMs = 60_000) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 5 * 60_000) {
    throw new Error("Secret grant TTL must be between 1 and 300 seconds");
  }
  return new Date(now.getTime() + ttlMs);
}

export function mayConsumeSecretGrant(
  grant: { status: string; expiresAt: Date; consumedAt?: Date | null; revokedAt?: Date | null },
  now = new Date(),
) {
  return (
    grant.status === "issued" && !grant.consumedAt && !grant.revokedAt && grant.expiresAt > now
  );
}
