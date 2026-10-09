import type { BotMood, GrokColorDef } from "@rakazo/core";
import { avatarIdentitySeed, JEWEL_VIEWBOX, jewelCut } from "@rakazo/core";
import { useEffect, useMemo } from "react";
import { Pressable } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { G, Path, Polygon, Rect } from "react-native-svg";

const SHADE = {
  light: { fill: "#ffffff", opacity: 0.3 },
  mid: { fill: "#ffffff", opacity: 0.06 },
  dark: { fill: "#000000", opacity: 0.24 },
} as const;

/**
 * The jewel character on mobile: shared cut geometry from core, moods as Reanimated
 * transform/opacity loops on the UI thread. Long-press wobbles, tap squishes; neither
 * ever dismisses a request.
 */
export function JewelAvatar({
  colorDef,
  identity,
  size,
  mood,
  interactive = false,
}: {
  colorDef: GrokColorDef;
  identity: string;
  size: number;
  mood: BotMood;
  interactive?: boolean;
}) {
  const cut = useMemo(() => jewelCut(avatarIdentitySeed(identity)), [identity]);
  const reducedMotion = useReducedMotion();
  const loop = useSharedValue(0);
  const pet = useSharedValue(1);
  const wobble = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(loop);
    loop.value = 0;
    const period =
      mood === "needs_you"
        ? 2_000
        : mood === "sleeping"
          ? 5_000
          : mood === "trying_hard"
            ? 1_000
            : 0;
    if (!reducedMotion && (period || mood === "working")) {
      loop.value = withRepeat(
        withTiming(1, { duration: period || 1_400, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    }
    return () => cancelAnimation(loop);
  }, [loop, mood, reducedMotion]);

  const gemStyle = useAnimatedStyle(() => {
    const t = loop.value;
    const breathe = mood === "sleeping" ? 1 + t * 0.03 : 1;
    const effortX = mood === "trying_hard" ? 1 + t * 0.05 : 1;
    const effortY = mood === "trying_hard" ? 1 - t * 0.06 : 1;
    const shrink =
      mood === "working" || mood === "trying_hard" ? 0.78 : mood === "needs_you" ? 0.82 : 1;
    return {
      transform: [
        { rotate: `${mood === "thinking" ? -6 : wobble.value}deg` },
        { scaleX: shrink * breathe * effortX * pet.value },
        { scaleY: shrink * breathe * effortY * pet.value },
      ],
    };
  });
  const ringStyle = useAnimatedStyle(() => ({
    opacity: mood === "needs_you" ? 0.85 - loop.value * 0.6 : mood === "working" ? 0.9 : 0,
    transform: [{ rotate: mood === "working" ? `${loop.value * 360}deg` : "0deg" }],
  }));

  const { leftX, rightX, y, width, height } = cut.eyes;
  const eyeStroke = {
    fill: "none",
    stroke: colorDef.eyeColor,
    strokeWidth: width * 0.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const eyes =
    mood === "happy" ? (
      <G {...eyeStroke}>
        {[leftX, rightX].map((x) => (
          <Path
            key={x}
            d={`M${x - width * 0.7} ${y + 2}L${x} ${y - 3}L${x + width * 0.7} ${y + 2}`}
          />
        ))}
      </G>
    ) : mood === "trying_hard" ? (
      <G {...eyeStroke}>
        <Path d={`M${leftX - 5} ${y - 4}L${leftX + 4} ${y}L${leftX - 5} ${y + 4}`} />
        <Path d={`M${rightX + 5} ${y - 4}L${rightX - 4} ${y}L${rightX + 5} ${y + 4}`} />
      </G>
    ) : mood === "sleeping" ? (
      <G {...eyeStroke}>
        {[leftX, rightX].map((x) => (
          <Path
            key={x}
            d={`M${x - width * 0.7} ${y + 1}Q${x} ${y + 3} ${x + width * 0.7} ${y + 1}`}
          />
        ))}
      </G>
    ) : (
      <G fill={colorDef.eyeColor} opacity={mood === "error" ? 0.7 : 1}>
        {[leftX, rightX].map((x) => {
          const h =
            mood === "error" ? height * 0.55 : mood === "needs_you" ? height * 1.12 : height;
          const lift = mood === "needs_you" ? -3 : mood === "error" ? 2 : 0;
          return (
            <Rect
              key={x}
              x={x - width / 2}
              y={y - h / 2 + lift}
              width={width}
              height={h}
              rx={width / 2}
            />
          );
        })}
      </G>
    );

  const body = (
    <Animated.View style={[{ width: size, height: size }, gemStyle]}>
      <Svg width={size} height={size} viewBox={JEWEL_VIEWBOX}>
        <Polygon points={cut.outline} fill={colorDef.hex} stroke={colorDef.dark} strokeWidth={2} />
        {cut.facets.map((facet) => (
          <Polygon
            key={facet.points}
            points={facet.points}
            fill={SHADE[facet.shade].fill}
            fillOpacity={SHADE[facet.shade].opacity}
            stroke="#ffffff"
            strokeOpacity={0.22}
            strokeWidth={0.8}
          />
        ))}
        <Polygon
          points={cut.table}
          fill="#ffffff"
          fillOpacity={0.14}
          stroke="#ffffff"
          strokeOpacity={0.4}
          strokeWidth={0.8}
        />
        {mood === "error" || mood === "sleeping" ? (
          <Polygon points={cut.outline} fill="#000000" fillOpacity={0.28} />
        ) : null}
        {eyes}
      </Svg>
    </Animated.View>
  );

  const ring = (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          inset: 0,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: colorDef.light,
          borderTopColor: mood === "working" ? "transparent" : colorDef.light,
          borderLeftColor: mood === "working" ? "transparent" : colorDef.light,
        },
        ringStyle,
      ]}
    />
  );

  if (!interactive) {
    return (
      <>
        {ring}
        {body}
      </>
    );
  }
  const asking = mood === "needs_you" || mood === "error";
  return (
    <Pressable
      accessible={false}
      onPress={() => {
        if (reducedMotion) return;
        pet.value = withSequence(
          withTiming(asking ? 0.97 : 0.92, { duration: 100 }),
          withSpring(1, { damping: 8 }),
        );
      }}
      onLongPress={() => {
        if (reducedMotion || asking) return;
        wobble.value = withSequence(
          withRepeat(withTiming(7, { duration: 130 }), 4, true),
          withSpring(0, { damping: 6 }),
        );
      }}
    >
      {ring}
      {body}
    </Pressable>
  );
}
