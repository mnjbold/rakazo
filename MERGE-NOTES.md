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

## Verification
- `pnpm turbo check` (typecheck): PASS, all packages.
- `pnpm lint` (biome): 0 errors (31 warnings, 21 infos, mostly upstream `useTemplate`).
- `vitest run`: 19662 passed / 81 failed / 671 skipped; 35 files failing (1145 passing). No baseline run on old main.
  Failing groups (follow-up):
  - Brand/avatar assertions expecting upstream logo vs jewel avatar (ui-web avatars, appearance, logo-avatar-render, create-bot-dialog, mobile avatar).
  - Fork executor tests (executor-live-call, executor-watch, reply-quality) need model setup for upstream's run-start flow.
  - executor / runtime-context instruction text (fork vs upstream wording).
  - router-messaging lines (pairing now admin-gated), backup-scripts, compose-env, desktop setup, voice, misc.

## Failing test files
- apps/api/src/bot-image-draft.test.ts > createBotImageDrafter > returns a validated draft and sends the image to the model once
- apps/api/src/router-messaging.test.ts > messaging.lines > lets the owner pair by QR, see the connected number, and unlink
- apps/api/src/router-messaging.test.ts > messaging.lines > reports an unreachable gateway as a 502 without leaking the upstream error
- apps/api/src/router.test.ts > account preferences > accepts an avatar style from an older app without storing it
- apps/api/src/voice.test.ts > server MiniMax voice fallback > uses a real MiniMax voice id, not the speech model name
- apps/desktop/src/setup.test.ts > setup > keeps a newer check busy when a stale check settles after it starts
- apps/desktop/src/setup.test.ts > setup > normalizes the address and reports success for the current check
- apps/desktop/src/setup.test.ts > setup > re-attaches to the running stack after returning to This computer
- apps/desktop/src/setup.test.ts > setup > renders a current start and follows it until it saves the ready stack
- apps/mobile/lib/avatar-life.test.tsx > activity mark > shows each working member of a group in turn, every 2 s
- apps/mobile/lib/avatar-life.test.tsx > avatar motion on mobile > plays an organic avatar's working clips in the inbox while its bot works
- apps/mobile/lib/bot-avatar-render.test.tsx > BotAvatar > draws a plain-colour bot with the organic body for its identity
- apps/mobile/lib/bot-avatar-render.test.tsx > BotAvatar > draws the muted badge with the dark theme tokens for #3EC5A8
- apps/mobile/lib/bot-avatar-render.test.tsx > BotAvatar > draws the muted badge with the light theme tokens for #3EC5A8
- apps/mobile/lib/i18n.test.ts > mobile i18n > translates every mobile chrome t() id in every non-English catalog
- apps/mobile/lib/model-settings.test.tsx > keeps setup help and API key collapsible for generic compatible servers
- apps/mobile/lib/native-switch-compose.test.tsx > guarded Android Compose switch > uses green and neutral colors in light with a compact host
- apps/web/src/components/ai/CollaborationMarker.test.tsx > collaboration transcript markers > animates the active bot glyph from its run status
- apps/web/src/components/ai/CollaborationMarker.test.tsx > collaboration transcript markers > shows a centred peer event with its avatar and full label
- apps/web/src/lib/logo-avatar-render.test.tsx > keeps static SVG artwork mounted through rapid live activity changes
- apps/web/src/lib/logo-avatar-render.test.tsx > projects production feed events into the live avatar and subscribes only live Rakazo consumers
- apps/web/src/lib/logo-avatar-render.test.tsx > renders generic work elsewhere when the open chat is idle, preserving live detail
- apps/web/src/lib/logo-avatar-render.test.tsx > retains the live pose through overlapping feed hydration, hidden updates and reconnect
- apps/web/src/pages/VoiceSettingsOverlay.test.tsx > connects a keyless provider without asking for a key
- apps/web/src/pages/VoiceSettingsOverlay.test.tsx > connects a self-hosted speech server by URL without a key
- apps/web/src/pages/shell/avatar-studio-popover.test.tsx > selectable bot icon sets > keeps a legacy appearance on open, saves a Rakazo switch, and restores the saved set on reload
- apps/web/src/pages/shell/create-bot-dialog.test.tsx > CreateBotDialog > defaults new bots to the Original set with the family the preview draws
- apps/web/src/pages/shell/create-bot-dialog.test.tsx > CreateBotDialog > sends the Rakazo preview id without an organic family
- apps/web/src/pages/shell/create-bot-dialog.test.tsx > CreateBotDialog > sends the organic family the preview draws
- apps/web/src/pages/shell/create-bot-dialog.test.tsx > retains the preview identity and colour through rerenders, set toggles and a retry
- infra/sandboxes/supervisor/src/computer-loopback.test.ts > provisioning network rollback > pulls the published computer image again after host cleanup removed it
- infra/updater/src/compose-env.test.ts > api and worker environment allowlists > docker-compose.images.yml passes each process exactly the settings it reads
- infra/updater/src/compose-env.test.ts > api and worker environment allowlists > docker-compose.prod.yml + docker-compose.prod.docker.yml passes each process exactly the settings it reads
- infra/updater/src/compose-env.test.ts > api and worker environment allowlists > docker-compose.prod.yml passes each process exactly the settings it reads
- infra/updater/src/compose-env.test.ts > api and worker environment allowlists > docker-compose.yml passes each process exactly the settings it reads
- packages/adapters/src/background-job-handlers.test.ts > retries retired messaging credentials without deleting a currently referenced credential
- packages/adapters/src/executor-live-call.test.ts > live call runs > adds the live-call instruction only for live runs
- packages/adapters/src/executor-live-call.test.ts > live call runs > does not persist a silent reply as a chat bubble
- packages/adapters/src/executor-live-call.test.ts > live call runs > shares the exact silent token with routines and keeps any reply with extra words
- packages/adapters/src/executor-live-call.test.ts > live call runs > tells the model what was heard only for an interrupted live run
- packages/adapters/src/executor-watch.test.ts > watch routines > finish silently with no message or push when nothing is new
- packages/adapters/src/executor-watch.test.ts > watch routines > leave ordinary routines without watch context
- packages/adapters/src/executor-watch.test.ts > watch routines > post a new item once and stay silent on the next run
- packages/adapters/src/executor.test.ts > userTurnInstructions > ends with the untrusted-content block when no optional context exists
- packages/adapters/src/executor.test.ts > userTurnInstructions > inserts task catalog guidance after the computer line
- packages/adapters/src/executor.test.ts > userTurnInstructions > places stable guidance before volatile context when every optional context is present
- packages/adapters/src/favicon.test.ts > favicon SSRF guard > sends no cookies or credentials and a fixed user agent
- packages/adapters/src/pi-models.test.ts > Pi model catalog > preserves provider names and sign-in options from before pi 1.3
- packages/adapters/src/reply-quality.test.ts > reply.judge enqueue > enqueues after a people-facing reply only
- packages/adapters/src/reply-quality.test.ts > self-improvement loop > puts lessons from poorly scored replies into the next run's instructions
- packages/adapters/src/runtime-context.test.ts > runtime context policy > places a rolling summary after Pi's leading system message
- packages/adapters/src/runtime-context.test.ts > runtime context policy > preserves an existing rolling summary when it fits
- packages/auth/src/index.test.ts > passwordResetEmail > keeps the reset URL in text and escapes user-controlled HTML
- packages/contracts/src/group-members.test.ts > group member limits > accepts a whole-team group well past the old six-bot cap
- packages/contracts/src/index.test.ts > contracts > accepts a GitHub-only routine trigger
- packages/core/src/message-visibility.test.ts > user-visible messages > hides a live-call reply that chose silence, streamed or final
- packages/db/src/repos.test.ts > createRepos.listSpaceBotsForSpaces > loads and maps only the compact cross-space sidebar fields
- packages/db/src/repos.test.ts > sidebar bot attention > marks waiting bots as needing you and unread failed bots as errors
- packages/testkit/src/backup-scripts.test.ts > off-site copies > keeps the verified local snapshot but fails the run: {"FAIL_RCLONE":"check"}
- packages/testkit/src/backup-scripts.test.ts > off-site copies > keeps the verified local snapshot but fails the run: {"FAIL_RCLONE":"copy"}
- packages/testkit/src/backup-scripts.test.ts > off-site copies > keeps the verified local snapshot but fails the run: {"RAKAZO_BACKUP_AGE_RECIPIENTS":""}
- packages/testkit/src/backup-scripts.test.ts > production backup deployment and archive behavior > refuses to run while another backup holds the lock
- packages/ui-tokens/src/appearance.test.ts > appearance preference > keeps working-state blue in its own semantic token across themes
- packages/ui-tokens/src/appearance.test.ts > web palette > gives the dark primary fill web-only hover and disabled states
- packages/ui-tokens/src/appearance.test.ts > web palette > gives the light primary fill web-only hover and disabled states
- packages/ui-tokens/src/appearance.test.ts > web palette > leaves the mobile palettes unchanged
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > draws every plain-colour bot with the organic body
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > fills the organic body with the resolved palette hex when the custom color is invalid
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > keeps working attribute false when idle
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > marks active run status leased as working
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > marks active run status queued as working
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > marks active run status running as working
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > previews an organic body when no studio shape is given
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > restores a plain color that renders the organic body instead of a pinned shape
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > shows needs-you, not working, for waiting_input
- packages/ui-web/src/bot-avatar.test.tsx > BotAvatar > shows needs-you, not working, for waiting_takeover
- packages/ui-web/src/group-avatar.test.tsx > GroupAvatar > renders 2 overlapping bot avatars for 2 members
- packages/ui-web/src/group-avatar.test.tsx > GroupAvatar > renders 3 mini bot avatars for 3 members
- packages/ui-web/src/group-avatar.test.tsx > GroupAvatar > renders a working member inside a group avatar
- packages/ui-web/src/group-avatar.test.tsx > GroupAvatar > renders single BotAvatar when 1 member
- packages/ui-web/src/logo-avatar.test.tsx > logo-derived avatar prototype > uses the shared identity colour during SSR when no saved choice is supplied

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
