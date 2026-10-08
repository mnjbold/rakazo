import type { BotImageDraft, ComputerMode } from "@rakazo/contracts";
import {
  ATTACHMENT_IMAGE_MIME_TYPES,
  BOT_DESCRIPTION_MAX_LENGTH,
  BOT_IMAGE_DRAFT_MAX_BYTES,
  BOT_NAME_MAX_LENGTH,
  BOT_TITLE_MAX_LENGTH,
  normalizeCreateBotProfile,
} from "@rakazo/contracts";
import * as ImagePicker from "expo-image-picker";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput } from "react-native";
import { ComputerModePicker } from "../components/computer-mode-picker";
import { NativeActionButton } from "../components/native-action-button";
import { cancelHeaderOptions } from "../components/sheet-header";
import type { MobileBot } from "../lib/api";
import { rpc } from "../lib/api";
import { allowFocusPrompt, scheduleFocusPrompt } from "../lib/focus-prompt";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { errorText } from "../lib/user-error";

export default function NewBot() {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [computerMode, setComputerMode] = useState<ComputerMode>("team");
  const [color, setColor] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    if (router.canDismiss()) {
      router.dismiss();
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }

  async function draftFromImage() {
    if (pending) return;
    // quality < 1 makes iOS re-encode HEIC picks as JPEG.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
    });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset?.base64) return;
    const mimeType = asset.mimeType ?? "image/jpeg";
    if (!(ATTACHMENT_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      setError(t("Use a PNG, JPEG, WebP, or GIF image."));
      return;
    }
    if ((asset.base64.length * 3) / 4 > BOT_IMAGE_DRAFT_MAX_BYTES) {
      setError(t("Image must be 5 MB or smaller."));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const draft = await rpc<BotImageDraft>("bots/draftFromImage", {
        mimeType,
        contentBase64: asset.base64,
      });
      setName(draft.name);
      setTitle(draft.title);
      setDescription(draft.instructions);
      setColor(draft.color);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Could not create bot"));
    } finally {
      setPending(false);
    }
  }

  async function create() {
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      // Failed list is unknown — delay focus rather than treating the bot as first.
      const existing = await rpc<MobileBot[]>("bots/list").catch(() => null);
      const isFirstBot = existing !== null && existing.length === 0;
      const bot = await rpc<MobileBot>("bots/create", {
        ...normalizeCreateBotProfile({ name, title, description }),
        notifyOnFinish: true,
        computerMode,
        ...(color ? { color } : {}),
      });
      allowFocusPrompt(bot.id);
      router.replace({ pathname: "/thread", params: { botId: bot.id, name: bot.name } });
      void (async () => {
        const started = await rpc("onboarding/start", { botId: bot.id })
          .then(() => true)
          .catch(() => false);
        if (!started) return;
        scheduleFocusPrompt(bot.id, isFirstBot);
      })();
    } catch (err) {
      setError(errorText(err, t("Could not create bot")));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Stack.Screen options={cancelHeaderOptions(t("Cancel"), close)} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: tokens.background }}
        contentContainerStyle={{ padding: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Pressable
          onPress={() => void draftFromImage()}
          disabled={pending}
          accessibilityRole="button"
          style={{ alignSelf: "flex-start", paddingVertical: 8, marginBottom: 16 }}
        >
          <Text style={{ color: tokens.foreground, fontSize: 16 }}>{t("Create from image")}</Text>
        </Pressable>
        <Text style={{ color: tokens.mutedForeground, fontSize: 14 }}>{t("Name")}</Text>
        <TextInput
          value={name}
          maxLength={BOT_NAME_MAX_LENGTH}
          onChangeText={setName}
          placeholder={t("Name this bot")}
          placeholderTextColor={tokens.mutedForeground}
          style={{
            marginTop: 8,
            backgroundColor: native.fill,
            borderRadius: 11,
            padding: 16,
            color: tokens.foreground,
          }}
        />
        <Text style={{ color: tokens.mutedForeground, marginTop: 16, fontSize: 14 }}>
          {t("Title")}
        </Text>
        <TextInput
          value={title}
          maxLength={BOT_TITLE_MAX_LENGTH}
          onChangeText={setTitle}
          placeholder={t("Describe what this bot does")}
          placeholderTextColor={tokens.mutedForeground}
          style={{
            marginTop: 8,
            backgroundColor: native.fill,
            borderRadius: 11,
            padding: 16,
            color: tokens.foreground,
          }}
        />
        <Text style={{ color: tokens.mutedForeground, marginTop: 16, fontSize: 14 }}>
          {t("Description")}
        </Text>
        <TextInput
          value={description}
          maxLength={BOT_DESCRIPTION_MAX_LENGTH}
          onChangeText={setDescription}
          placeholder={t("What this bot is for")}
          placeholderTextColor={tokens.mutedForeground}
          multiline
          style={{
            marginTop: 8,
            backgroundColor: native.fill,
            borderRadius: 11,
            padding: 16,
            color: tokens.foreground,
            minHeight: 120,
            textAlignVertical: "top",
          }}
        />
        <ComputerModePicker value={computerMode} onChange={setComputerMode} />
        {error ? <Text style={{ color: tokens.destructive, marginTop: 16 }}>{error}</Text> : null}
        <NativeActionButton
          disabled={!name.trim() || pending}
          label={pending ? t("Creating…") : t("Create")}
          onPress={() => void create()}
          style={{ marginTop: 24 }}
        />
      </ScrollView>
    </>
  );
}
