import { createNodeWebSocket } from "@hono/node-ws";
import { GeminiLiveSession } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";
import type { Context, Hono } from "hono";
import { loadDefaultVoiceCredential, type VoiceDeps } from "./voice.js";

export function mountLiveVoiceRoute(
  app: Hono,
  deps: VoiceDeps,
  authenticate: (c: Context) => Promise<Actor | null>,
) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get(
    "/api/voice/live",
    upgradeWebSocket(async (c) => {
      const actor = await authenticate(c);
      if (!actor) {
        return {
          onOpen(_evt, ws) {
            ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
            ws.close();
          },
        };
      }

      let session: GeminiLiveSession | null = null;
      let receiving = false;

      return {
        async onOpen(_evt, ws) {
          try {
            const loaded = await loadDefaultVoiceCredential(deps, actor);
            if (!loaded?.apiKey) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "No voice provider key configured. Add a voice key in Voice settings.",
                }),
              );
              ws.close();
              return;
            }

            session = await GeminiLiveSession.open(loaded.apiKey, {
              voiceId: loaded.cred.voiceId || undefined,
            });

            receiving = true;
            (async () => {
              try {
                if (!session) return;
                for await (const frame of session.receive()) {
                  if (!receiving) break;
                  if (frame.audio) {
                    ws.send(Buffer.from(frame.audio));
                  } else if (frame.control) {
                    ws.send(JSON.stringify({ type: frame.control }));
                  } else if (frame.transcript) {
                    ws.send(
                      JSON.stringify({
                        type: "transcript",
                        role: frame.transcript.role,
                        text: frame.transcript.text,
                      }),
                    );
                  }
                }
              } catch (err) {
                getLogger().warn("live voice receive error", { error: String(err) });
              }
            })();
          } catch (err) {
            getLogger().error("live voice connection failed", err);
            ws.send(
              JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : "Failed to open live voice session",
              }),
            );
            ws.close();
          }
        },

        onMessage(evt, _ws) {
          if (!session) return;
          const data = evt.data;
          if (typeof data === "string") {
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              if (parsed.type === "interrupt") {
                session.sendAudioEnd();
              }
            } catch {
              // Ignore malformed text frames
            }
          } else if (data instanceof ArrayBuffer) {
            if (data.byteLength === 0) {
              session.sendAudioEnd();
            } else {
              session.sendAudio(new Uint8Array(data));
            }
          } else if (ArrayBuffer.isView(data)) {
            if (data.byteLength === 0) {
              session.sendAudioEnd();
            } else {
              session.sendAudio(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            }
          }
        },

        onClose() {
          receiving = false;
          session?.close();
          session = null;
        },

        onError(err) {
          getLogger().warn("live voice websocket error", { error: String(err) });
          receiving = false;
          session?.close();
          session = null;
        },
      };
    }),
  );

  return { injectWebSocket };
}
