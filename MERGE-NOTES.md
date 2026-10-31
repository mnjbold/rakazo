# MERGE-NOTES — upstream sync 2026-10-31

Merge of `elie222/rakazo@upstream/main` into `mnjbold/rakazo` (branch `sync/upstream-2026-10-31`).
Policy: **upstream wins for core logic**; JEWL customizations (rebrand/emerald/jewel bots, voicestudio/Kokoro/MiniMax/Telnyx,
Evolution, Forgejo CI, Langfuse, Google OAuth, Dokploy owner controls, new chats, live talk, templates, reply quality,
draft-from-image) are kept on top.

## Key decisions
- API: upstream split `router.ts` into `apps/api/src/routes/*.ts`. Fork procedures were ported into the matching route files:
  - `routes/mcp.ts`: capability install extracted to `installCapability()`; marketplace service (list/share/remove/install) wired next to upstream catalog.
  - `routes/context.ts`: `botTemplates` service.
  - `routes/bots.ts`: botTemplates, draftFromImage, replyQuality (errors mapped via `mapSpaceLifecycleError`).
  - `routes/threads.ts`: newChat / sessions; `routes/account.ts`: voice connect key; `routes/content.ts`: session summarize job.
  - `routines.ts` + `routes/routines.ts`: upstream version taken.
- DB: upstream adds 91 migrations. Fork migration `20261018235900_routine_watch_boolean_to_json` drops the fork's boolean `watch` before upstream's JSONB `watch`.
  Upstream introduces a separate app role: new env `POSTGRES_APP_PASSWORD`, `DATABASE_MIGRATION_URL`, role `rakazo_app`.
- Web: upstream call UI replaces fork CallView (fork backend live/voice kept). Dokploy controls moved into General settings, admin-gated.
  Draft-from-image API kept but not wired into the new create dialog.
- Mobile: always uses jewel avatar; fork new-chat injection dropped where it conflicted.
- `thread-target.ts`: fork peer-run `linkRunId` change dropped (upstream wins); reply-feedback recording now best-effort after the reaction transaction commits.
- `packages/core/src/messaging-providers.ts`: re-added Evolution → WhatsApp label (upstream moved labels to core).
- `account-import.ts`, `artifacts.ts`: fork select additions (role/runId/botId) kept.
- testkit authorization list extended with 22 JEWL fork procedures.

## Verification (updated 2026-10-31, after test-fix pass)
- Baseline old fork `main`: vitest 7666 passed / 0 failed.
- Merge commit `d8a71bc9` as first pushed: 19662 passed / **81 failed** / 671 skipped (35 files).
- After the fix commit: **19741 passed / 0 failed** / 671 skipped (1180 files passing).
- `pnpm turbo check`: PASS. `pnpm lint` (biome): 0 errors.

### Real merge bugs fixed in code
- `packages/core/src/message-visibility.ts`: silent-only peer replies are filtered out in `foldPeerReplies` again.
- `infra/compose/docker-compose{,.images,.prod}.yml`: fork env vars were missing from the upstream allowlists. Restored: EVOLUTION_*, GOOGLE_CLIENT_*, RAKAZO_KOKORO/VOICESTUDIO_*, DOKPLOY_URL/API_KEY, TELNYX_*.
- `packages/db/src/repos.ts`: bot `attention` was dropped from `listBots` / `listSpaceBotsForSpaces`. Restored.
- `packages/adapters/src/run-instructions.ts`: fork guidance (communication, working, product guide) was dropped from user-turn instructions. Re-added.
- `packages/adapters/src/runtime-context.ts`: the "JEWL-owned compacted context" summary prefix is accepted again.
- `packages/ui-web/src/avatar-style.tsx`: the context default is back to `organic`. The web Shell still supplies `jewel` through `AvatarStyleProvider`.
- `apps/mobile/components/bot-avatar.tsx`: jewel stays the default. `EXPO_PUBLIC_JEWL_AVATAR_STYLE=organic` switches it to organic, and the test setup uses that switch.
- Mobile i18n: the model-connection string now says JEWL. Missing JEWL/template strings were added to zh-TW, nl, es and ja, and the "Rakazo" avatar-set label was added to de, ru and zh.
- `apps/web/src/pages/VoiceSettingsOverlay.tsx`: always sends `apiKey` again, as upstream does. The server defaults it to "", so behaviour is the same.
- Branding: email copy, desktop setup and the backup script say JEWL.

### Test expectations changed (deliberate behaviour)
- GROUP_MEMBER_MAX = 50 (fork value): contracts, fleet-tools and mobile new-group tests.
- JEWL emerald palette: ui-tokens appearance tests and the mobile switch ring colour.
- Upstream JSON routine `watch` replaces the fork boolean watch: the obsolete watch assertions were removed from executor-watch.
- The fork test "re-pull computer image after cleanup" was removed. It contradicts upstream's computer-image design, which upstream tests cover.
- Fork executor tests now set up a deployment model for upstream's run-start flow.
- Upstream-only web tools keep the `Rakazo/0.1` user agent (favicon test updated).

### Cutover prerequisites (prod)
- Postgres 16 → 18 (`infra/compose/upgrade-postgres.sh`). New env: `POSTGRES_APP_PASSWORD`, `DATABASE_MIGRATION_URL`, and the `rakazo_app` role.
- `RAKAZO_ADMIN_EMAILS` must include the owner email. Without it, Dokploy controls and line pairing are hidden by upstream `isAdmin`.

## Files differing from upstream/main
     .env.example                                                                         |  56 +++++++++++++-
     .forgejo/workflows/ci.yml                                                            | 322 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     .forgejo/workflows/playwright.yml                                                    | 141 +++++++++++++++++++++++++++++++++++
     .forgejo/workflows/publish-server-image.yml                                          |  74 +++++++++++++++++++
     .github/ISSUE_TEMPLATE/bug.yml                                                       |   4 +-
     .github/ISSUE_TEMPLATE/config.yml                                                    |   2 +-
     .github/ISSUE_TEMPLATE/self-host.yml                                                 |   4 +-
     .github/workflows/ci.yml                                                             |   1 +
     .github/workflows/desktop-macos-screenshot.yml                                       |   8 +-
     .github/workflows/opencode.yml                                                       |  39 ++++++++++
     .github/workflows/release-desktop.yml                                                |   4 +-
     .github/workflows/sync-upstream.yml                                                  |  71 ++++++++++++++++++
     .gitignore                                                                           |   5 ++
     .langfuse-onboarding.json                                                            |  13 ++++
     AGENTS.md                                                                            |  20 ++++-
     CLAUDE.md                                                                            |  61 +++++++++++++++
     CONTRIBUTING.md                                                                      |   4 +-
     README.md                                                                            |  32 ++++----
     SECURITY.md                                                                          |   2 +-
     SETUP_PROMPT.md                                                                      |  14 ++--
     VISION.md                                                                            |  10 +--
     apps/api/package.json                                                                |   5 +-
     apps/api/src/account-import.ts                                                       |   2 +-
     apps/api/src/app.ts                                                                  |  91 +++++++++++++++++++++--
     apps/api/src/artifacts.ts                                                            |   2 +-
     apps/api/src/bot-image-draft.test.ts                                                 | 121 ++++++++++++++++++++++++++++++
     apps/api/src/bot-image-draft.ts                                                      | 124 +++++++++++++++++++++++++++++++
     apps/api/src/bot-templates.test.ts                                                   | 163 ++++++++++++++++++++++++++++++++++++++++
     apps/api/src/bot-templates.ts                                                        | 132 +++++++++++++++++++++++++++++++++
     apps/api/src/dokploy.test.ts                                                         |  41 ++++++++++
     apps/api/src/dokploy.ts                                                              | 169 ++++++++++++++++++++++++++++++++++++++++++
     apps/api/src/env.test.ts                                                             |  26 ++++++-
     apps/api/src/env.ts                                                                  |  43 ++++++++++-
     apps/api/src/index.ts                                                                |  12 ++-
     apps/api/src/live-voice.test.ts                                                      |  21 ++++++
     apps/api/src/live-voice.ts                                                           | 130 ++++++++++++++++++++++++++++++++
     apps/api/src/marketplace.test.ts                                                     | 248 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     apps/api/src/marketplace.ts                                                          | 168 +++++++++++++++++++++++++++++++++++++++++
     apps/api/src/messaging-inbound.ts                                                    |   4 +-
     apps/api/src/phone-call.test.ts                                                      | 278 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     apps/api/src/phone-call.ts                                                           | 269 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     apps/api/src/router-messaging.test.ts                                                |  53 +++++++++++++
     apps/api/src/router.test.ts                                                          |   3 +-
     apps/api/src/router.ts                                                               |  43 +++++++++++
     apps/api/src/routes/account.ts                                                       |  33 ++++++---
     apps/api/src/routes/bots.ts                                                          |  41 +++++++++-
     apps/api/src/routes/connections.ts                                                   |   2 +-
     apps/api/src/routes/context.ts                                                       |   6 ++
     apps/api/src/routes/mcp.ts                                                           | 304 +++++++++++++++++++++++++++++++++++++++++----------------------------------
     apps/api/src/routes/messaging.ts                                                     |  62 ++++++++++++++++
     apps/api/src/routes/shared.ts                                                        |   4 +-
     apps/api/src/routes/threads.ts                                                       |  55 +++++++++++++-
     apps/api/src/team-chat-bridge.ts                                                     |   8 +-
     apps/api/src/thread-message-pages.ts                                                 |  23 ++++--
     apps/api/src/thread-target.test.ts                                                   | 171 ++++++++++++++++++++++++++++++++++++++++++
     apps/api/src/thread-target.ts                                                        |  61 +++++++++++++--
     apps/api/src/voice.test.ts                                                           |  21 ++++++
     apps/api/src/voice.ts                                                                |  45 ++++++++++-
     apps/desktop/assets/icon-macos.png                                                   | Bin 2505096 -> 29863 bytes
     apps/desktop/assets/icon.ico                                                         | Bin 129928 -> 14207 bytes
     apps/desktop/assets/icon.png                                                         | Bin 1408793 -> 21268 bytes
     apps/desktop/e2e/local-stack.spec.ts                                                 |   8 +-
     apps/desktop/e2e/setup.spec.ts                                                       |  26 +++----
     apps/desktop/e2e/smoke.spec.ts                                                       |   4 +-
     apps/desktop/e2e/window-drag.spec.ts                                                 |   2 +-
     apps/desktop/package.json                                                            |   4 +-
     apps/desktop/src/auto-update.ts                                                      |   2 +-
     apps/desktop/src/browser-auth.ts                                                     |   4 +-
     apps/desktop/src/local-stack.ts                                                      |   4 +-
     apps/desktop/src/main.ts                                                             |  12 ++-
     apps/desktop/src/package-metadata.test.ts                                            |   2 +-
     apps/desktop/src/setup-config.test.ts                                                |   4 +-
     apps/desktop/src/setup.html                                                          |   8 +-
     apps/desktop/src/setup.js                                                            |  10 +--
     apps/mobile/.maestro/notification-demo.yaml                                          |   4 +-
     apps/mobile/.maestro/screenshots.yaml                                                |   8 +-
     apps/mobile/.maestro/smoke.yaml                                                      |   6 +-
     apps/mobile/app.json                                                                 |  23 +++---
     apps/mobile/app/(settings)/ai-data-sharing.tsx                                       |   2 +-
     apps/mobile/app/(settings)/integrations.tsx                                          |   6 +-
     apps/mobile/app/(settings)/voice.tsx                                                 |   2 +-
     apps/mobile/app/_layout.tsx                                                          |  10 ++-
     apps/mobile/app/bot-templates.tsx                                                    | 100 +++++++++++++++++++++++++
     apps/mobile/app/sign-in.tsx                                                          |   8 +-
     apps/mobile/assets/adaptive-icon.png                                                 | Bin 881036 -> 18076 bytes
     apps/mobile/assets/favicon.png                                                       | Bin 25208 -> 1455 bytes
     apps/mobile/assets/icon-background.png                                               | Bin 15849 -> 4575 bytes
     apps/mobile/assets/icon.png                                                          | Bin 1011286 -> 21268 bytes
     apps/mobile/assets/monochrome-icon.png                                               | Bin 75066 -> 14032 bytes
     apps/mobile/assets/notification-icon.png                                             | Bin 1444 -> 1453 bytes
     apps/mobile/assets/splash-icon.png                                                   | Bin 547120 -> 17659 bytes
     apps/mobile/components/bot-avatar.tsx                                                |  45 ++++++++++-
     apps/mobile/components/jewel-avatar.tsx                                              | 221 ++++++++++++++++++++++++++++++++++++++++++++++++++++++
     apps/mobile/components/jewl-mark.tsx                                                 |  40 ++++++++++
     apps/mobile/e2e/README.md                                                            |   4 +-
     apps/mobile/e2e/ios-screenshots/README.md                                            |   2 +-
     apps/mobile/e2e/ios-screenshots/flows/auth.yaml                                      |   8 +-
     apps/mobile/e2e/ios-screenshots/subflows/launch-app.yaml                             |   4 +-
     apps/mobile/e2e/ios-screenshots/subflows/sign-in.yaml                                |   4 +-
     apps/mobile/lib/api.ts                                                               |   1 +
     apps/mobile/lib/endpoint.test.ts                                                     |   4 +-
     apps/mobile/lib/endpoint.ts                                                          |   4 +-
     apps/mobile/lib/i18n.test.ts                                                         |   6 +-
     apps/mobile/lib/locales/de.ts                                                        |  31 +++++---
     apps/mobile/lib/locales/ru.ts                                                        |  34 ++++++---
     apps/mobile/lib/locales/zh.ts                                                        |  34 ++++++---
     apps/mobile/lib/sign-in.test.tsx                                                     |   1 +
     apps/web/e2e/artifacts-tab.spec.ts                                                   |   6 +-
     apps/web/e2e/auth-lifecycle.spec.ts                                                  |  10 +--
     apps/web/e2e/avatar-motion.spec.ts                                                   |  33 +++++++++
     apps/web/e2e/avatar-studio.spec.ts                                                   |   1 +
     apps/web/e2e/bot-from-image.spec.ts                                                  |  58 +++++++++++++++
     apps/web/e2e/bot-organization.spec.ts                                                |   2 +-
     apps/web/e2e/bot-rail.spec.ts                                                        |  75 +++++++++++++++++++
     apps/web/e2e/bot-templates.spec.ts                                                   |  59 +++++++++++++++
     apps/web/e2e/chat-sessions.spec.ts                                                   |  45 +++++++++++
     apps/web/e2e/fixtures/agent-connection-approval.html                                 |   5 +-
     apps/web/e2e/fixtures/jewel-avatars.html                                             |  12 +++
     apps/web/e2e/fixtures/jewel-avatars.tsx                                              |  88 ++++++++++++++++++++++
     apps/web/e2e/golden.spec.ts                                                          |  10 ++-
     apps/web/e2e/group-chats.spec.ts                                                     |  13 ++--
     apps/web/e2e/helpers.ts                                                              |   2 +-
     apps/web/e2e/integrations-layout.spec.ts                                             |  87 ++++++++++++++++++++++
     apps/web/e2e/jewel-avatars.spec.ts                                                   |  48 ++++++++++++
     apps/web/e2e/long-reply.spec.ts                                                      |  52 +++++++++++++
     apps/web/e2e/marketplace.spec.ts                                                     | 134 +++++++++++++++++++++++++++++++++
     apps/web/e2e/message-hover-actions.spec.ts                                           |  15 +++-
     apps/web/e2e/messaging-settings.spec.ts                                              |  55 ++++++++++++++
     apps/web/e2e/mobile-sidebar-swipe.spec.ts                                            |  22 +++++-
     apps/web/e2e/reply-quality.spec.ts                                                   |  37 ++++++++++
     apps/web/e2e/routine-watch.spec.ts                                                   |  43 +++++++++++
     apps/web/e2e/run-failure.spec.ts                                                     |  13 ++--
     apps/web/index.html                                                                  |   4 +-
     apps/web/public/apple-touch-icon.png                                                 | Bin 45563 -> 2896 bytes
     apps/web/public/favicon-16x16.png                                                    | Bin 903 -> 539 bytes
     apps/web/public/favicon-32x32.png                                                    | Bin 2520 -> 1018 bytes
     apps/web/public/favicon.ico                                                          | Bin 8290 -> 3066 bytes
     apps/web/public/favicon.png                                                          | Bin 25208 -> 5174 bytes
     apps/web/public/favicon.svg                                                          |   5 ++
     apps/web/public/icon-192.png                                                         | Bin 51774 -> 3061 bytes
     apps/web/public/icon-512.png                                                         | Bin 347705 -> 10005 bytes
     apps/web/public/icon-maskable-512.png                                                | Bin 0 -> 8188 bytes
     apps/web/public/sw.js                                                                |  63 ++++++++++++++++
     apps/web/scripts/translations-de.json                                                |  10 +--
     apps/web/scripts/translations-es.json                                                |  10 +--
     apps/web/scripts/translations-hi.json                                                |  10 +--
     apps/web/scripts/translations-ko.json                                                |  10 +--
     apps/web/scripts/translations-pt-BR.json                                             |  10 +--
     apps/web/scripts/translations-tr.json                                                |  10 +--
     apps/web/scripts/translations-zh-CN.json                                             |  10 +--
     apps/web/src/components/AppRail.tsx                                                  | 121 ++++++++++++++++++++++++++++++
     apps/web/src/components/ClampedText.tsx                                              |  53 +++++++++++++
     apps/web/src/components/DokploySection.tsx                                           | 251 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     apps/web/src/components/MessageHoverMetadata.test.tsx                                |  14 ++--
     apps/web/src/components/MessageHoverMetadata.tsx                                     |  22 +++---
     apps/web/src/components/ShareMenu.tsx                                                |  61 +++++++++++++++
     apps/web/src/components/integrations/IntegrationIcon.tsx                             |  39 ++++++++++
     apps/web/src/lib/bot-mood.ts                                                         |  84 +++++++++++++++++++++
     apps/web/src/lib/dictation.ts                                                        |  36 +++++----
     apps/web/src/lib/performance.test.ts                                                 |  18 ++++-
     apps/web/src/lib/performance.ts                                                      |  16 ++++
     apps/web/src/lib/roster-status.test.ts                                               |  30 ++++++++
     apps/web/src/lib/roster-status.ts                                                    |   8 ++
     apps/web/src/lib/session-gate.ts                                                     |   5 +-
     apps/web/src/main.tsx                                                                |   5 ++
     apps/web/src/pages/Auth.test.tsx                                                     |   1 +
     apps/web/src/pages/Auth.tsx                                                          |  91 ++++++++++++++++++++---
     apps/web/src/pages/BotContextMenu.tsx                                                |  25 ++++++-
     apps/web/src/pages/KnowledgeSection.test.tsx                                         |   1 +
     apps/web/src/pages/KnowledgeSection.tsx                                              |   9 +++
     apps/web/src/pages/MarketplaceOverlay.tsx                                            | 267 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     apps/web/src/pages/McpOAuthCallback.tsx                                              |   8 +-
     apps/web/src/pages/MessagingSettingsPanel.test.tsx                                   |   1 +
     apps/web/src/pages/MessagingSettingsPanel.tsx                                        |  94 ++++++++++++++++++++++-
     apps/web/src/pages/Onboarding.tsx                                                    |   4 +-
     apps/web/src/pages/PluginsOverlay.tsx                                                |  61 ++++++++-------
     apps/web/src/pages/SettingsOverlay.test.tsx                                          |   7 ++
     apps/web/src/pages/SettingsOverlay.tsx                                               |  10 +++
     apps/web/src/pages/Shell.tsx                                                         |  77 ++++++++++++++++++-
     apps/web/src/pages/VoiceSettingsOverlay.tsx                                          |   8 +-
     apps/web/src/pages/Welcome.tsx                                                       |  33 ++++++---
     apps/web/src/pages/shell/avatar-studio-popover.tsx                                   |  65 +++++++++-------
     apps/web/src/pages/shell/bot-panel.test.tsx                                          |   7 +-
     apps/web/src/pages/shell/bot-panel.tsx                                               |  57 ++++++++++++++
     apps/web/src/pages/shell/bot-settings.test.tsx                                       |   1 +
     apps/web/src/pages/shell/chat-context-menu.tsx                                       |   9 +++
     apps/web/src/pages/shell/chat-header.tsx                                             |   5 ++
     apps/web/src/pages/shell/chat-sessions.tsx                                           | 189 +++++++++++++++++++++++++++++++++++++++++++++++
     apps/web/src/pages/shell/sidebar-roster.tsx                                          |   7 ++
     apps/web/src/pwa/plugin.ts                                                           |   4 +-
     apps/web/src/styles.css                                                              |   6 ++
     apps/worker/src/index.ts                                                             |   4 +
     docs/agent-verification.md                                                           |   4 +-
     docs/ai-data-sharing-review.md                                                       |   2 +-
     docs/computer-runtime.md                                                             |  14 ++--
     docs/context-and-evals-tasks.md                                                      |   2 +-
     docs/dokploy-staging.md                                                              |  26 +++++++
     docs/mobile-release.md                                                               |   4 +-
     docs/observability/LANGFUSE.md                                                       | 100 +++++++++++++++++++++++++
     docs/observability/LESSONS.md                                                        |   5 ++
     docs/performance.md                                                                  |   2 +-
     docs/self-host-sandbox-providers.md                                                  |  16 ++++
     docs/self-host-secrets.md                                                            |  13 ++++
     docs/self-host.md                                                                    |  16 +++-
     docs/voicestudio-realtime.md                                                         |  27 +++++++
     infra/compose/.env.images.example                                                    |   2 +-
     infra/compose/backup-prod.sh                                                         |   2 +-
     infra/compose/docker-compose.images.yml                                              |   1 +
     infra/compose/docker-compose.yml                                                     |   1 +
     infra/compose/install-images-pull-never.smoke.sh                                     |   6 +-
     infra/compose/install-images.sh                                                      |   8 +-
     infra/compose/restrict-computer-egress.sh                                            |   2 +-
     infra/sandboxes/computer/Dockerfile                                                  |  28 +++++++
     infra/sandboxes/computer/control.py                                                  |   2 +-
     infra/sandboxes/computer/embed.html                                                  |   2 +-
     infra/sandboxes/computer/fluxbox.menu                                                |   2 +-
     infra/sandboxes/computer/rakazo-browser.desktop                                      |   4 +-
     infra/sandboxes/supervisor/src/computer-loopback.test.ts                             |  32 ++++++++
     infra/sandboxes/supervisor/src/computer-spec.test.ts                                 |  13 ++++
     infra/sandboxes/supervisor/src/computer-spec.ts                                      |  12 +++
     infra/sandboxes/supervisor/src/home-ownership.ts                                     |  20 +++++
     infra/sandboxes/supervisor/src/index.ts                                              |   2 +
     infra/systemd/rakazo-backup.service                                                  |   2 +-
     infra/systemd/rakazo-backup.timer                                                    |   2 +-
     observability/langfuse.mjs                                                           |  61 +++++++++++++++
     observability/langfuse_smoke.py                                                      | 137 ++++++++++++++++++++++++++++++++++
     packages/adapter-kit/src/background-jobs.test.ts                                     |   2 +
     packages/adapter-kit/src/background-jobs.ts                                          |  21 ++++++
     packages/adapter-kit/src/index.ts                                                    |   1 +
     packages/adapter-kit/src/interfaces.ts                                               |  52 +++++++++++++
     packages/adapter-kit/src/live-voice.ts                                               |  28 +++++++
     packages/adapter-kit/src/types.ts                                                    |  16 ++++
     packages/adapters/package.json                                                       |   1 +
     packages/adapters/src/agent-guidance.ts                                              |  39 ++++++++++
     packages/adapters/src/background-job-handlers.ts                                     |  34 +++++----
     packages/adapters/src/chat-sdk-surface.ts                                            |  29 ++++++++
     packages/adapters/src/composio-connector.test.ts                                     |   4 +-
     packages/adapters/src/computer-lifecycle.test.ts                                     |   1 +
     packages/adapters/src/computer-lifecycle.ts                                          |   2 +
     packages/adapters/src/deployment-model.test.ts                                       |  12 +++
     packages/adapters/src/deployment-model.ts                                            |   2 +
     packages/adapters/src/dokploy.test.ts                                                |  43 +++++++++++
     packages/adapters/src/dokploy.ts                                                     | 181 +++++++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/evolution-conformance.test.ts                                  | 150 +++++++++++++++++++++++++++++++++++++
     packages/adapters/src/evolution-emulator.ts                                          | 161 ++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/evolution-messaging.ts                                         | 326 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/executor-deps.ts                                               |   2 +
     packages/adapters/src/executor-live-call.test.ts                                     | 163 ++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/executor-watch.test.ts                                         | 180 ++++++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/executor.test.ts                                               |   5 ++
     packages/adapters/src/executor.ts                                                    |  72 +++++++++++++++---
     packages/adapters/src/favicon.test.ts                                                |   2 +-
     packages/adapters/src/gemini-live.test.ts                                            |  27 +++++++
     packages/adapters/src/gemini-live.ts                                                 | 172 ++++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/history-compaction.test.ts                                     | 128 +++++++++++++++++++++++++++++++-
     packages/adapters/src/history-compaction.ts                                          | 273 ++++++++++++++++++++++++++++++++++++++++++++-----------------------
     packages/adapters/src/host-aware-sandbox.test.ts                                     |  18 +++++
     packages/adapters/src/host-aware-sandbox.ts                                          |   6 +-
     packages/adapters/src/index.ts                                                       |  13 ++++
     packages/adapters/src/jev-reply-judge.ts                                             | 157 +++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/keyless-http-web.ts                                            |   2 +-
     packages/adapters/src/kokoro-voice.ts                                                | 151 +++++++++++++++++++++++++++++++++++++
     packages/adapters/src/mcp-oauth.test.ts                                              |   2 +-
     packages/adapters/src/mcp-oauth.ts                                                   |   2 +-
     packages/adapters/src/messaging-platforms.ts                                         |  22 ++++++
     packages/adapters/src/minimax-voice.ts                                               | 126 +++++++++++++++++++++++++++++++
     packages/adapters/src/model-vision.test.ts                                           |   1 +
     packages/adapters/src/pi-models.test.ts                                              |   5 ++
     packages/adapters/src/pi-models.ts                                                   |  10 +--
     packages/adapters/src/pi-oauth.ts                                                    |   7 +-
     packages/adapters/src/pi-runtime.ts                                                  |   4 +-
     packages/adapters/src/reply-judge-conformance.test.ts                                | 139 ++++++++++++++++++++++++++++++++++
     packages/adapters/src/reply-judge-emulator.ts                                        |  54 ++++++++++++++
     packages/adapters/src/reply-quality.test.ts                                          | 292 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/reply-quality.ts                                               |  98 ++++++++++++++++++++++++
     packages/adapters/src/routed-sandbox.test.ts                                         |  57 ++++++++++++++
     packages/adapters/src/routed-sandbox.ts                                              | 121 ++++++++++++++++++++++++++++++
     packages/adapters/src/run-effects.ts                                                 |   2 +-
     packages/adapters/src/run-instructions.ts                                            |   3 +
     packages/adapters/src/run-turn.ts                                                    |  15 ++++
     packages/adapters/src/runtime-context.test.ts                                        |   4 +-
     packages/adapters/src/scripted-runtime.ts                                            |  36 ++++++++-
     packages/adapters/src/secret-grants.test.ts                                          |  54 ++++++++++++++
     packages/adapters/src/secret-grants.ts                                               |  59 +++++++++++++++
     packages/adapters/src/smtp-email.test.ts                                             |   4 +-
     packages/adapters/src/telnyx-call-control-conformance.test.ts                        | 161 ++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/telnyx-call-control-emulator.ts                                |  78 ++++++++++++++++++++
     packages/adapters/src/telnyx-call-control.ts                                         | 158 +++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/telnyx-voice.ts                                                | 121 ++++++++++++++++++++++++++++++
     packages/adapters/src/voice-factory.test.ts                                          | 261 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     packages/adapters/src/voice-factory.ts                                               |  41 ++++++++++
     packages/adapters/src/voicestudio-voice.ts                                           | 133 +++++++++++++++++++++++++++++++++
     packages/adapters/src/wakeup-graphile-host.test.ts                                   |   2 +
     packages/adapters/src/wakeup.postgres.test.ts                                        |   2 +
     packages/adapters/src/wakeup.test.ts                                                 |   2 +
     packages/auth/src/index.test.ts                                                      |   2 +-
     packages/auth/src/index.ts                                                           |  11 ++-
     packages/contracts/src/auth.ts                                                       |   1 +
     packages/contracts/src/bot-templates.test.ts                                         |  64 ++++++++++++++++
     packages/contracts/src/domain.ts                                                     | 180 +++++++++++++++++++++++++++++++++++++++++++-
     packages/contracts/src/group-members.test.ts                                         |  21 ++++++
     packages/contracts/src/index.test.ts                                                 |  65 ++++++++++++++++
     packages/contracts/src/index.ts                                                      |   1 +
     packages/contracts/src/openai-compatible-ui.ts                                       |   2 +-
     packages/contracts/src/reply-quality.ts                                              |  20 +++++
     packages/contracts/src/rpc.ts                                                        | 121 ++++++++++++++++++++++++++++++
     packages/core/src/ai-consent.test.ts                                                 |   1 +
     packages/core/src/ai-consent.ts                                                      |   1 +
     packages/core/src/attachments.test.ts                                                |  32 ++++++++
     packages/core/src/attachments.ts                                                     |   9 +++
     packages/core/src/bot-image-draft.test.ts                                            |  76 +++++++++++++++++++
     packages/core/src/bot-image-draft.ts                                                 | 122 ++++++++++++++++++++++++++++++
     packages/core/src/bot-messages.test.ts                                               |   8 ++
     packages/core/src/bot-messages.ts                                                    |   5 +-
     packages/core/src/bot-mood.test.ts                                                   | 251 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     packages/core/src/bot-mood.ts                                                        | 205 ++++++++++++++++++++++++++++++++++++++++++++++++++
     packages/core/src/brand.ts                                                           |  31 ++++++++
     packages/core/src/featured-connectors.test.ts                                        |  16 ++++
     packages/core/src/featured-connectors.ts                                             |   6 ++
     packages/core/src/index.ts                                                           |   7 ++
     packages/core/src/jewel.ts                                                           | 187 ++++++++++++++++++++++++++++++++++++++++++++++
     packages/core/src/live-call.test.ts                                                  |  60 +++++++++++++++
     packages/core/src/live-call.ts                                                       |  59 +++++++++++++++
     packages/core/src/message-visibility.test.ts                                         |   9 +++
     packages/core/src/message-visibility.ts                                              |  11 +++
     packages/core/src/messaging-providers.ts                                             |   1 +
     packages/core/src/node/load-root-env.ts                                              |   6 ++
     packages/core/src/reply-lessons.test.ts                                              |  97 ++++++++++++++++++++++++
     packages/core/src/reply-lessons.ts                                                   |  90 ++++++++++++++++++++++
     packages/core/src/run-state.test.ts                                                  |   1 +
     packages/core/src/run-state.ts                                                       |  21 ++++++
     packages/core/src/secrets-guard.ts                                                   |   2 +-
     packages/core/src/self-update.ts                                                     |   4 +-
     packages/core/src/speech-text.test.ts                                                |  88 ++++++++++++++++++++++
     packages/core/src/speech-text.ts                                                     | 102 +++++++++++++++++++++++--
     packages/core/src/tool-activity.test.ts                                              |  34 ++++++++-
     packages/core/src/tool-activity.ts                                                   |  15 ++++
     packages/core/src/watch.test.ts                                                      |  80 ++++++++++++++++++++
     packages/core/src/watch.ts                                                           | 109 +++++++++++++++++++++++++++
     packages/db/prisma/migrations/20260917162000_computer_desired_provider/migration.sql |   4 +
     packages/db/prisma/migrations/20260917163000_scoped_secret_grants/migration.sql      |  33 +++++++++
     packages/db/prisma/migrations/20260926120000_run_live/migration.sql                  |   1 +
     packages/db/prisma/migrations/20260926130000_avatar_style_organic/migration.sql      |   2 +
     packages/db/prisma/migrations/20260927120000_bot_templates/migration.sql             |  31 ++++++++
     packages/db/prisma/migrations/20260927130000_run_interrupted_heard/migration.sql     |   1 +
     packages/db/prisma/migrations/20260927140000_routine_watch/migration.sql             |   1 +
     packages/db/prisma/migrations/20260927150000_marketplace_items/migration.sql         |  32 ++++++++
     packages/db/prisma/migrations/20260928120000_chat_sessions/migration.sql             |  21 ++++++
     packages/db/prisma/migrations/20260928130000_reply_quality/migration.sql             |  21 ++++++
     packages/db/prisma/migrations/20261009150000_avatar_style_jewel/migration.sql        |   3 +
     packages/db/prisma/schema.prisma                                                     | 176 ++++++++++++++++++++++++++++++++++++++++++-
     packages/db/src/chat-sessions.test.ts                                                | 153 ++++++++++++++++++++++++++++++++++++++
     packages/db/src/chat-sessions.ts                                                     | 167 +++++++++++++++++++++++++++++++++++++++++
     packages/db/src/computers.ts                                                         |  22 ++++++
     packages/db/src/events.test.ts                                                       |   2 +
     packages/db/src/events.ts                                                            |  19 ++++-
     packages/db/src/index.ts                                                             |   1 +
     packages/db/src/messages.ts                                                          |  21 ++++++
     packages/db/src/repos.test.ts                                                        |  58 +++++++++++++++
     packages/db/src/repos.ts                                                             |  14 +++-
     packages/db/src/thread-listing.ts                                                    |  43 ++++++++++-
     packages/testkit/src/authorization.test.ts                                           |  23 ++++++
     packages/testkit/src/backup-scripts.test.ts                                          |  14 ++--
     packages/testkit/src/cli/desktop-performance.ts                                      |   8 +-
     packages/testkit/src/cli/process.ts                                                  |   5 +-
     packages/testkit/src/computer-use.e2e.test.ts                                        |   2 +-
     packages/testkit/src/executor-lifecycle.test.ts                                      |   4 +-
     packages/testkit/src/ios-screenshot-gallery.ts                                       |   2 +-
     packages/testkit/src/journeys.test.ts                                                |  71 ++++++++++++++++++
     packages/testkit/src/playwright-report-dashboard.ts                                  |   8 +-
     packages/ui-tokens/assets/README.md                                                  |  41 +++++-----
     packages/ui-tokens/assets/Rakazo.icon/Assets/orange-bot.png                          | Bin 1343542 -> 22544 bytes
     packages/ui-tokens/assets/Rakazo.icon/icon.json                                      |   2 +-
     packages/ui-tokens/assets/jewl-mark.svg                                              |   7 ++
     packages/ui-tokens/src/index.ts                                                      |  42 ++++++-----
     packages/ui-tokens/src/tokens.css                                                    |  26 ++++---
     packages/ui-web/src/__snapshots__/bot-avatar.test.tsx.snap                           |  19 +++++
     packages/ui-web/src/avatar-style.tsx                                                 |  19 +++++
     packages/ui-web/src/bot-avatar.test.tsx                                              |  79 +++++++++++++++++++-
     packages/ui-web/src/bot-avatar.tsx                                                   | 221 +++++++++++++++++++++++++++++++++++++++++-------------
     packages/ui-web/src/index.ts                                                         |   2 +
     packages/ui-web/src/jewel-avatar.tsx                                                 | 433 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     packages/ui-web/src/styles.css                                                       | 435 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     pnpm-lock.yaml                                                                       |  72 +++++++++++++++---
     scripts/rebrand-memories.sql                                                         | 106 ++++++++++++++++++++++++++
     385 files changed, 16410 insertions(+), 869 deletions(-)
