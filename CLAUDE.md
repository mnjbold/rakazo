# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

pnpm 9 + Turborepo monorepo. Node 22.22.2+ (22.x), 24.x, or 26+; 23.x and 25.x are unsupported.

```bash
# first-time setup (needs .env from .env.example with the required secrets set)
docker compose --env-file .env -f infra/compose/docker-compose.yml up postgres -d
pnpm install && pnpm db:generate && pnpm db:migrate && pnpm sandbox:build
pnpm dev                                # api + worker + web + sandbox-supervisor → http://127.0.0.1:5173

pnpm lint                               # Biome lint + format check (pnpm format to fix)
pnpm check                              # tsc across the monorepo (depends on ^generate)
pnpm test                               # root vitest: units, properties, in-process contracts; offline
pnpm test:integration                   # Testcontainers Postgres; needs Docker
pnpm test:e2e                           # Playwright against the emulated API; needs Docker
```

Single test: `pnpm vitest run packages/core/src/cron.test.ts` (add `-t "<name>"` for one case). Per-package `test` scripts run the root vitest scoped to their `src`, e.g. `pnpm --filter @rakazo/api test`.

- `*.postgres.test.ts` files skip unless `VERIFY_DATABASE` and `DATABASE_URL` are set. The integration harness ([packages/testkit/src/cli/harness.ts](packages/testkit/src/cli/harness.ts)) sets both, starts a Postgres container, and runs an explicit suite list with one cloned database per suite. **New integration suites must be added to that list.**
- `pnpm --filter @rakazo/db migrate:dev` creates a Prisma migration in `packages/db/prisma/`.
- `pnpm --filter @rakazo/ui-tokens generate` regenerates `tokens.css` from the TypeScript token source.
- `pnpm --filter @rakazo/web intl:extract` / `intl:compile` for Lingui strings.
- [CONTRIBUTING.md](CONTRIBUTING.md) lists the other test tiers (`test:pi`, `test:computer-replay`, `test:topology`, `test:canary`, `test:evals`, `test:computer`) and says which ones need Docker or live keys. CI runs lint, check, builds, test, test:integration, and test:e2e.

## Architecture

**Apps** ([apps/](apps/)): `api` (Hono + oRPC server), `worker` (Graphile Worker background jobs and agent run execution), `web` (React 19 + Vite; the dev server proxies the API and noVNC screen streams), `desktop` (Electron shell that hosts the web build or manages a local Compose stack), `mobile` (Expo), `www` (Astro marketing site). `infra/sandboxes/supervisor` runs inside computer sandboxes; `infra/compose` holds the self-host stack.

**Request path:** the oRPC contract lives in [packages/contracts/src/rpc.ts](packages/contracts/src/rpc.ts). [apps/api/src/router.ts](apps/api/src/router.ts) implements it, and web and mobile call it through typed clients ([apps/web/src/lib/rpc.ts](apps/web/src/lib/rpc.ts)). Thread updates stream over SSE subscriptions and reach other processes through Postgres LISTEN/NOTIFY (`PostgresRealtimeFanout`). To change an endpoint, edit the contract first, then the router, then the clients.

**Package layers:**
- `contracts`: shared wire types, IDs, events, and the RPC contract.
- `core`: pure domain logic shared by server and clients (mentions, cron, approvals, composer parsing, …). Node-only helpers such as `load-root-env` live under the `@rakazo/core/node/*` entry points.
- `adapter-kit`: the provider-neutral **port interfaces** (`SandboxProvider`, `AgentRuntime`, `MemoryStore`, `SecretStore`, `MessagingSurface`, `VoiceProvider`, `CloudAgentProvider`, …) plus an `AdapterRegistry` keyed by `slots`.
- `adapters`: every concrete implementation (Docker/E2B/Daytona/Box sandboxes, the Pi agent runtime, Composio/Pipedream/MCP connectors, voice, messaging, …). Vendors come with an **emulator** (`*-emulator.ts`) and a `*-conformance.test.ts` so tests run offline. In tests, `ScriptedAgentRuntime` and the fake sandbox replace real models and computers.
- `db` (Prisma schema, migrations, query helpers), `auth` (Better Auth), `memory` (markdown memory store), `logging`, `ui-tokens`, `ui-web` (vendored shadcn on Base UI), `chat-ui` (markdown rendering split into `.web.tsx` and `.native.tsx`).
- `testkit`: the test harness CLIs (`src/cli/`), model and computer emulators, product-journey and authorization suites, and eval cases.

**Composition roots:** [apps/worker/src/index.ts](apps/worker/src/index.ts) and `createApp` in [apps/api/src/app.ts](apps/api/src/app.ts) read env config (`SANDBOX_PROVIDER`, `AGENT_RUNTIME`, `resolveSandboxProvider`, `resolveDeploymentModel`, …), pick the adapters, and wire them together. `createApp` also accepts injected adapters, and that is how tests use it. Adding a provider takes three pieces: an adapter in `packages/adapters` behind an existing `adapter-kit` interface, an emulator with a conformance test, and selection logic in these two roots only.
