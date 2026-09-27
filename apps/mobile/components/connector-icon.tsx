import { integrationMonogram } from "@rakazo/core";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { SvgUri } from "react-native-svg";
import { native, useThemedStyles } from "../lib/native";

/** Catalog logo, matching web, or a same-size monogram when the logo is missing or fails. */
export function ConnectorIcon({
  name,
  logo,
  size = 32,
}: {
  name: string;
  logo?: string | null;
  size?: number;
}) {
  const styles = useThemedStyles(createStyles);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const uri = logo && logo !== failedLogo ? logo : null;
  const art = Math.round(size * 0.78);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { width: size, height: size, borderRadius: size * 0.28 }]}
    >
      {uri ? (
        /\.svg(?:[?#]|$)/i.test(uri) ? (
          <SvgUri uri={uri} width={art} height={art} onError={() => setFailedLogo(uri)} />
        ) : (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri }}
            resizeMode="contain"
            onError={() => setFailedLogo(uri)}
            style={{ width: art, height: art }}
          />
        )
      ) : (
        <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{integrationMonogram(name)}</Text>
      )}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    frame: {
      backgroundColor: native.fillPressed,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    letter: { color: native.label, fontWeight: "600" },
  });
}
