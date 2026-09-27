import { JEWL_MARK } from "@rakazo/core";
import { useId } from "react";
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from "react-native-svg";
import { useMobileTokens } from "../lib/native";

/** The JEWL mark on its soft brand halo, matching web's `JewlMark glow`. Decorative. */
export function JewlMark({ size = 56 }: { size?: number }) {
  const tokens = useMobileTokens();
  const glowId = `jewl-glow-${useId().replace(/:/g, "")}`;
  const halo = size * 2.8;
  const inset = (halo - size) / 2;
  return (
    <Svg
      width={halo}
      height={halo}
      style={{ marginVertical: -inset, alignSelf: "center" }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={tokens.brand} stopOpacity={0.2} />
          <Stop offset="0.4" stopColor={tokens.brand} stopOpacity={0.05} />
          <Stop offset="0.7" stopColor={tokens.brand} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={halo / 2} cy={halo / 2} r={halo / 2} fill={`url(#${glowId})`} />
      <G
        transform={`translate(${inset} ${inset}) scale(${size / 64})`}
        fill={tokens.brand}
        stroke={tokens.brand}
        strokeWidth={JEWL_MARK.strokeWidth}
        strokeLinejoin="round"
      >
        <Path d={JEWL_MARK.crown} />
        <Path fillRule="evenodd" d={JEWL_MARK.pavilion} />
      </G>
    </Svg>
  );
}
