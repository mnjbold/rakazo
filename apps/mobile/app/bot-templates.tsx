import type { BotTemplate } from "@rakazo/contracts";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { BotAvatar } from "../components/bot-avatar";
import { type MobileBot, rpc } from "../lib/api";
import { allowFocusPrompt, scheduleFocusPrompt } from "../lib/focus-prompt";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";

export default function BotTemplates() {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const [templates, setTemplates] = useState<BotTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    void rpc<BotTemplate[]>("botTemplates/list")
      .then(setTemplates)
      .catch((err: unknown) => {
        setTemplates([]);
        setError(err instanceof Error ? err.message : t("Try again."));
      });
  }, [t]);

  async function use(template: BotTemplate) {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    try {
      const bot = await rpc<MobileBot>("botTemplates/use", {
        templateId: template.id,
        computerMode: "team",
      });
      allowFocusPrompt(bot.id);
      router.replace({ pathname: "/thread", params: { botId: bot.id, name: bot.name } });
      void rpc("onboarding/start", { botId: bot.id })
        .then(() => scheduleFocusPrompt(bot.id, false))
        .catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not create bot"));
    } finally {
      pending.current = false;
    }
  }

  if (!templates) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: tokens.background }}>
        <ActivityIndicator color={tokens.mutedForeground} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: tokens.background }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={templates}
      keyExtractor={(template) => template.id}
      ListHeaderComponent={
        error ? <Text style={{ color: tokens.destructive }}>{error}</Text> : null
      }
      ListEmptyComponent={
        <Text style={{ color: tokens.mutedForeground, textAlign: "center", marginTop: 24 }}>
          {t("No templates")}
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Use template {name}", { name: item.name })}
          onPress={() => void use(item)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 12,
            borderRadius: 11,
            backgroundColor: tokens.muted,
          }}
        >
          <BotAvatar color={item.color} identity={item.id} size={36} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 16 }}>
              {item.name}
            </Text>
            {item.title ? (
              <Text numberOfLines={1} style={{ color: tokens.mutedForeground, fontSize: 13 }}>
                {item.title}
              </Text>
            ) : null}
          </View>
        </Pressable>
      )}
    />
  );
}
