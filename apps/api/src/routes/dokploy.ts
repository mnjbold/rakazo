import { ORPCError } from "@orpc/server";
import { isAdmin } from "../admins.js";
import {
  dokployStatus,
  fullStackPreview,
  listDokployDeployments,
  operateDokploy,
  previewDokploy,
  readDokployLogs,
  rollbackDokploy,
} from "../dokploy.js";
import type { RouterContext } from "./context.js";

/**
 * JEWL fork: guarded Dokploy controls. Upstream removed app-level deployment owners
 * (#1915), so these are limited to verified RAKAZO_ADMIN_EMAILS accounts.
 */
export function dokployRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const config = () => ({ baseUrl: deps.env.dokployUrl, apiKey: deps.env.dokployApiKey });
  const requireAdmin = async (userId: string) => {
    if (!(await isAdmin(deps, userId))) throw new ORPCError("FORBIDDEN");
  };
  return {
    dokploy: {
      status: authed.dokploy.status.handler(async ({ context }) => {
        await requireAdmin(context.actor.userId);
        return dokployStatus(config());
      }),
      preview: authed.dokploy.preview.handler(async ({ context, input }) => {
        await requireAdmin(context.actor.userId);
        return previewDokploy(input);
      }),
      fullStackPreview: authed.dokploy.fullStackPreview.handler(async ({ context, input }) => {
        await requireAdmin(context.actor.userId);
        return fullStackPreview(input);
      }),
      deployments: authed.dokploy.deployments.handler(async ({ context, input, signal }) => {
        await requireAdmin(context.actor.userId);
        return listDokployDeployments(config(), input.serviceKind, input.serviceId, signal);
      }),
      logs: authed.dokploy.logs.handler(async ({ context, input, signal }) => {
        await requireAdmin(context.actor.userId);
        return readDokployLogs(config(), input.deploymentId, signal);
      }),
      rollback: authed.dokploy.rollback.handler(async ({ context, input, signal }) => {
        await requireAdmin(context.actor.userId);
        return rollbackDokploy(config(), input, signal);
      }),
      operate: authed.dokploy.operate.handler(async ({ context, input, signal }) => {
        await requireAdmin(context.actor.userId);
        return operateDokploy(config(), input, signal);
      }),
    },
  };
}
