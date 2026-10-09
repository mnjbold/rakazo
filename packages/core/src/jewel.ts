/**
 * Faceted-gem bot characters ("jewels"). Geometry only: a per-bot cut from the identity seed,
 * drawn in a -50..50 viewBox. Colors come from the bot's persona color, shaded per facet.
 */

export const JEWEL_CUTS = [
  "round",
  "princess",
  "emerald",
  "oval",
  "marquise",
  "pear",
  "heart",
  "trillion",
] as const;
export type JewelCutName = (typeof JEWEL_CUTS)[number];

export const JEWEL_VIEWBOX = "-50 -50 100 100";

export type JewelShade = "light" | "mid" | "dark";

export interface JewelCut {
  name: JewelCutName;
  /** SVG `points` for the girdle outline. */
  outline: string;
  /** SVG `points` for the crown table, where the face sits. */
  table: string;
  facets: { points: string; shade: JewelShade }[];
  /** Eye facet centers and size, in viewBox units. */
  eyes: { leftX: number; rightX: number; y: number; width: number; height: number };
  /** Where the glint sparkles, so no two bots twinkle in sync. */
  glint: { x: number; y: number };
  blinkSeconds: number;
  glintSeconds: number;
  /** Negative animation delay, de-syncing bots that share a cut. */
  delaySeconds: number;
  /** Rare double blink (one in ten bots). */
  doubleBlink: boolean;
}

type Point = readonly [number, number];

function ring(count: number, rx: number, ry: number, phase = 0, dy = 0): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = phase + (index / count) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(angle) * rx, Math.sin(angle) * ry + dy] as const;
  });
}

const OUTLINES: Record<JewelCutName, () => Point[]> = {
  round: () => ring(12, 44, 44, Math.PI / 12),
  princess: () => [
    [-40, -40],
    [0, -42],
    [40, -40],
    [42, 0],
    [40, 40],
    [0, 42],
    [-40, 40],
    [-42, 0],
  ],
  emerald: () => [
    [-28, -40],
    [28, -40],
    [42, -26],
    [42, 26],
    [28, 40],
    [-28, 40],
    [-42, 26],
    [-42, -26],
  ],
  oval: () => ring(10, 36, 46, Math.PI / 10),
  marquise: () => [
    [0, -48],
    [20, -32],
    [30, -10],
    [30, 10],
    [20, 32],
    [0, 48],
    [-20, 32],
    [-30, 10],
    [-30, -10],
    [-20, -32],
  ],
  pear: () => [
    [0, -48],
    [18, -26],
    [34, -2],
    [38, 18],
    [26, 38],
    [0, 46],
    [-26, 38],
    [-38, 18],
    [-34, -2],
    [-18, -26],
  ],
  heart: () => [
    [0, -24],
    [16, -42],
    [36, -38],
    [46, -18],
    [38, 8],
    [0, 46],
    [-38, 8],
    [-46, -18],
    [-36, -38],
    [-16, -42],
  ],
  trillion: () => [
    [0, -44],
    [24, -14],
    [46, 34],
    [0, 40],
    [-46, 34],
    [-24, -14],
  ],
};

const fmt = (value: number) => String(Math.round(value * 10) / 10);
const points = (list: readonly Point[]) => list.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");

/** A small integer mix so neighbouring seeds pick unrelated cuts and timings. */
function mix(seed: number, salt: number): number {
  let hash = Math.imul(seed ^ salt, 2654435761);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822519);
  return (hash ^ (hash >>> 13)) >>> 0;
}

export function jewelCut(seed: number): JewelCut {
  const name = JEWEL_CUTS[mix(seed, 1) % JEWEL_CUTS.length] ?? "round";
  const outline = OUTLINES[name]();
  const tableScale = 0.5 + (mix(seed, 2) % 9) / 100;
  // The table sits a little high, like a crown seen from above.
  const tableShift = -4;
  const table = outline.map(([x, y]) => [x * tableScale, y * tableScale + tableShift] as const);
  // Light falls from the upper left, nudged per bot.
  const lightAngle = (-135 + ((mix(seed, 3) % 31) - 15)) * (Math.PI / 180);
  const light = [Math.cos(lightAngle), Math.sin(lightAngle)] as const;

  const facets = outline.map((point, index) => {
    const next = outline[(index + 1) % outline.length] as Point;
    const tablePoint = table[index] as Point;
    const tableNext = table[(index + 1) % table.length] as Point;
    const midX = (point[0] + next[0]) / 2;
    const midY = (point[1] + next[1]) / 2;
    const length = Math.hypot(midX, midY) || 1;
    const facing = (midX / length) * light[0] + (midY / length) * light[1];
    const shade: JewelShade = facing > 0.35 ? "light" : facing < -0.35 ? "dark" : "mid";
    return { points: points([point, next, tableNext, tablePoint]), shade };
  });

  const xs = table.map(([x]) => x);
  const ys = table.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const tableW = maxX - minX;
  const tableH = maxY - minY;
  const centerX = (minX + maxX) / 2;
  // Heart and trillion tables are bottom-heavy; keep the face in the wide part.
  const centerY = (minY + maxY) / 2 + (name === "trillion" ? tableH * 0.18 : 0);
  const eyeSpread = Math.min(tableW * 0.2, 9);
  const glintCorner = table[mix(seed, 4) % table.length] as Point;

  return {
    name,
    outline: points(outline),
    table: points(table),
    facets,
    eyes: {
      leftX: Math.round((centerX - eyeSpread) * 10) / 10,
      rightX: Math.round((centerX + eyeSpread) * 10) / 10,
      y: Math.round(centerY * 10) / 10,
      width: 8,
      height: 14,
    },
    glint: {
      x: Math.round(((glintCorner[0] + centerX) / 2) * 10) / 10,
      y: Math.round(((glintCorner[1] + minY) / 2) * 10) / 10,
    },
    blinkSeconds: 3 + (mix(seed, 5) % 41) / 10,
    glintSeconds: 4 + (mix(seed, 6) % 61) / 10,
    delaySeconds: -((mix(seed, 7) % 70) / 10),
    doubleBlink: mix(seed, 8) % 10 === 0,
  };
}
