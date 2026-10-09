import type { BotMood, GrokColorDef, JewelCut } from "@rakazo/core";
import { avatarIdentitySeed, JEWEL_VIEWBOX, jewelCut } from "@rakazo/core";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./lib/utils.js";

type Pet = "squish" | "spin" | "dizzy" | "wobble" | "bounce" | "ack";

const PET_MS: Record<Pet, number> = {
  squish: 320,
  spin: 760,
  dizzy: 1_000,
  wobble: 0,
  bounce: 420,
  ack: 260,
};
const HOLD_MS = 450;
const SPIN_TAPS = 3;
const SPIN_WINDOW_MS = 1_500;
const DIZZY_TAPS = 7;
const DIZZY_WINDOW_MS = 3_000;

const SHADE_OVERLAY = {
  light: { fill: "#ffffff", opacity: 0.3 },
  mid: { fill: "#ffffff", opacity: 0.06 },
  dark: { fill: "#000000", opacity: 0.24 },
} as const;

// One observer for every jewel: offscreen avatars pause their CSS animations.
let offscreenObserver: IntersectionObserver | undefined;
function observeOffscreen(element: HTMLElement): () => void {
  if (typeof IntersectionObserver === "undefined") return () => undefined;
  offscreenObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      (entry.target as HTMLElement).dataset.offscreen = String(!entry.isIntersecting);
    }
  });
  offscreenObserver.observe(element);
  return () => offscreenObserver?.unobserve(element);
}

export interface JewelAvatarProps {
  colorDef: GrokColorDef;
  identity: string;
  size: number;
  mood: BotMood;
  onComputer?: boolean;
  /** The bot's computer panel is open: the gem hops toward it instead of showing a glyph. */
  computerOpen?: boolean;
  /** Pointer reactions (hover gaze, tap squish, long-press wobble). Client-only delight. */
  interactive?: boolean;
  className?: string;
}

/**
 * A faceted gem with two eye facets, cut and timed per bot. Moods are CSS poses and
 * transform/opacity keyframes only, so a long sidebar stays cheap.
 */
export function JewelAvatar({
  colorDef,
  identity,
  size,
  mood,
  onComputer = false,
  computerOpen = false,
  interactive = false,
  className,
}: JewelAvatarProps) {
  const cut = useMemo(() => jewelCut(avatarIdentitySeed(identity)), [identity]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pet, setPet] = useState<Pet | null>(null);
  const taps = useRef<number[]>([]);
  const holdTimer = useRef<number | undefined>(undefined);
  const held = useRef(false);

  useEffect(() => {
    const element = rootRef.current;
    return element ? observeOffscreen(element) : undefined;
  }, []);

  useEffect(() => {
    if (!pet || pet === "wobble") return;
    const timer = window.setTimeout(() => setPet(null), PET_MS[pet]);
    return () => window.clearTimeout(timer);
  }, [pet]);

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  // Petting never changes or hides a request: needs-you and error only blink back.
  const asking = mood === "needs_you" || mood === "error";

  const handlers = interactive
    ? {
        onPointerDown: () => {
          held.current = false;
          window.clearTimeout(holdTimer.current);
          if (asking) return;
          holdTimer.current = window.setTimeout(() => {
            held.current = true;
            setPet("wobble");
          }, HOLD_MS);
        },
        onPointerUp: () => {
          window.clearTimeout(holdTimer.current);
          if (asking) {
            setPet("ack");
            return;
          }
          if (held.current) {
            held.current = false;
            setPet("bounce");
            return;
          }
          const now = Date.now();
          taps.current = [...taps.current.filter((at) => now - at < DIZZY_WINDOW_MS), now];
          const recent = taps.current.filter((at) => now - at < SPIN_WINDOW_MS).length;
          if (taps.current.length >= DIZZY_TAPS) {
            taps.current = [];
            setPet("dizzy");
          } else if (recent === SPIN_TAPS) {
            setPet("spin");
          } else {
            setPet("squish");
          }
        },
        onPointerCancel: () => {
          window.clearTimeout(holdTimer.current);
          if (held.current) setPet("bounce");
          held.current = false;
        },
        onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
          const box = event.currentTarget.getBoundingClientRect();
          const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
          const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
          event.currentTarget.style.setProperty("--jewel-gx", `${clamp(dx) * 3}px`);
          event.currentTarget.style.setProperty("--jewel-gy", `${clamp(dy) * 3}px`);
        },
        onPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => {
          event.currentTarget.style.removeProperty("--jewel-gx");
          event.currentTarget.style.removeProperty("--jewel-gy");
          window.clearTimeout(holdTimer.current);
          if (held.current) setPet("bounce");
          held.current = false;
        },
      }
    : undefined;

  const style = {
    width: size,
    height: size,
    "--jewel-blink": `${cut.blinkSeconds}s`,
    "--jewel-glint": `${cut.glintSeconds}s`,
    "--jewel-delay": `${cut.delaySeconds}s`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={cn("rakazo-jewel-avatar relative inline-flex shrink-0 select-none", className)}
      style={style}
      data-mood={mood}
      data-cut={cut.name}
      data-pet={pet ?? undefined}
      data-hop={onComputer && computerOpen ? "true" : undefined}
      data-interactive={interactive ? "true" : undefined}
      data-double-blink={cut.doubleBlink ? "true" : undefined}
      // State reaches assistive tech through the row label, never the picture.
      aria-hidden="true"
      {...handlers}
    >
      {mood === "working" || mood === "trying_hard" ? (
        <svg
          className="rakazo-jewel-ring pointer-events-none absolute inset-0"
          viewBox="0 0 48 48"
          fill="none"
        >
          <circle
            cx="24"
            cy="24"
            r="22"
            stroke={colorDef.light}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeDasharray="40 98"
          />
        </svg>
      ) : null}
      {mood === "needs_you" ? (
        <span
          className="rakazo-jewel-pulse pointer-events-none absolute inset-0 rounded-full border-2"
          style={{ borderColor: colorDef.light }}
        />
      ) : null}
      <svg
        viewBox={JEWEL_VIEWBOX}
        width={size}
        height={size}
        className="rakazo-jewel-svg overflow-visible"
      >
        <g className="rakazo-jewel-hop">
          <g className="rakazo-jewel-pet">
            <g className="rakazo-jewel-gem">
              <JewelBody cut={cut} colorDef={colorDef} mood={mood} size={size} />
            </g>
          </g>
        </g>
      </svg>
      {onComputer ? <MonitorGlyph size={size} /> : null}
      {mood === "needs_you" || mood === "error" ? (
        <span
          className={cn(
            "rakazo-jewel-badge pointer-events-none absolute end-0 top-0 rounded-full border-2 border-background",
            mood === "error" ? "bg-destructive" : "bg-warning",
          )}
          style={{ width: badgeSize(size), height: badgeSize(size) }}
        />
      ) : null}
    </div>
  );
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function badgeSize(size: number): number {
  return Math.max(7, Math.round(size * 0.26));
}

function JewelBody({
  cut,
  colorDef,
  mood,
  size,
}: {
  cut: JewelCut;
  colorDef: GrokColorDef;
  mood: BotMood;
  size: number;
}) {
  return (
    <>
      <polygon
        points={cut.outline}
        fill={colorDef.hex}
        stroke={colorDef.dark}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <g className="rakazo-jewel-facets">
        {cut.facets.map((facet) => (
          <polygon
            key={facet.points}
            points={facet.points}
            fill={SHADE_OVERLAY[facet.shade].fill}
            fillOpacity={SHADE_OVERLAY[facet.shade].opacity}
            stroke="#ffffff"
            strokeOpacity={0.22}
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
        ))}
      </g>
      <polygon
        className="rakazo-jewel-table"
        points={cut.table}
        fill="#ffffff"
        fillOpacity={0.14}
        stroke="#ffffff"
        strokeOpacity={0.4}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      {mood === "error" ? (
        <polyline
          points={`${cut.eyes.rightX + 10},-30 ${cut.eyes.rightX + 4},-16 ${cut.eyes.rightX + 9},-8 ${cut.eyes.rightX + 3},4`}
          fill="none"
          stroke={colorDef.dark}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {mood === "sleeping" ? (
        <polygon points={cut.outline} fill="#000000" fillOpacity={0.28} />
      ) : null}
      <circle
        className="rakazo-jewel-glint"
        cx={cut.glint.x}
        cy={cut.glint.y}
        r={3}
        fill="#ffffff"
      />
      <g className="rakazo-jewel-gaze">
        <g className="rakazo-jewel-face">
          <JewelEyes cut={cut} mood={mood} color={colorDef.eyeColor} />
        </g>
      </g>
      {mood === "happy" ? (
        <g className="rakazo-jewel-sparkles" fill="#ffffff">
          {(
            [
              [-34, -34],
              [36, -30],
              [-30, 30],
              [34, 32],
            ] as const
          ).map(([x, y]) => (
            <path
              key={`${x}:${y}`}
              d={`M${x} ${y - 6}L${x + 2} ${y}L${x} ${y + 6}L${x - 2} ${y}Z`}
            />
          ))}
        </g>
      ) : null}
      {mood === "trying_hard" ? (
        <path
          className="rakazo-jewel-sweat"
          d="M30 -30C33 -25 35 -22 35 -19A5 5 0 0 1 25 -19C25 -22 27 -25 30 -30Z"
          fill="#ffffff"
          fillOpacity={0.8}
        />
      ) : null}
      {mood === "sleeping" && size >= 48 ? (
        <text
          className="rakazo-jewel-z"
          x={30}
          y={-34}
          fontSize={16}
          fontWeight={700}
          fill={colorDef.light}
        >
          z
        </text>
      ) : null}
    </>
  );
}

function JewelEyes({ cut, mood, color }: { cut: JewelCut; mood: BotMood; color: string }) {
  const { leftX, rightX, y, width, height } = cut.eyes;
  const stroke = {
    fill: "none",
    stroke: color,
    strokeWidth: width * 0.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const open = (scale = 1) => (
    <g className="rakazo-jewel-eyes rakazo-jewel-eyes-open" fill={color}>
      {[leftX, rightX].map((x) => (
        <rect
          key={x}
          x={x - width / 2}
          y={y - (height * scale) / 2}
          width={width}
          height={height * scale}
          rx={width / 2}
        />
      ))}
    </g>
  );
  switch (mood) {
    case "happy":
      return (
        <g className="rakazo-jewel-eyes" {...stroke}>
          {[leftX, rightX].map((x) => (
            <path
              key={x}
              d={`M${x - width * 0.7} ${y + 2}L${x} ${y - 3}L${x + width * 0.7} ${y + 2}`}
            />
          ))}
        </g>
      );
    case "trying_hard":
      return (
        <g className="rakazo-jewel-eyes" {...stroke}>
          <path
            d={`M${leftX - width * 0.6} ${y - 4}L${leftX + width * 0.5} ${y}L${leftX - width * 0.6} ${y + 4}`}
          />
          <path
            d={`M${rightX + width * 0.6} ${y - 4}L${rightX - width * 0.5} ${y}L${rightX + width * 0.6} ${y + 4}`}
          />
        </g>
      );
    case "sleeping":
      return (
        <g className="rakazo-jewel-eyes" {...stroke}>
          {[leftX, rightX].map((x) => (
            <path
              key={x}
              d={`M${x - width * 0.7} ${y + 1}Q${x} ${y + 3} ${x + width * 0.7} ${y + 1}`}
            />
          ))}
        </g>
      );
    case "error":
      return (
        <>
          <g className="rakazo-jewel-eyes rakazo-jewel-eyes-x" {...stroke}>
            {[leftX, rightX].map((x) => (
              <path
                key={x}
                d={`M${x - 3} ${y - 3}L${x + 3} ${y + 3}M${x + 3} ${y - 3}L${x - 3} ${y + 3}`}
              />
            ))}
          </g>
          <g className="rakazo-jewel-eyes-sorry">{open(0.55)}</g>
        </>
      );
    case "needs_you":
    case "listening":
      return open(1.12);
    default:
      return open();
  }
}

function MonitorGlyph({ size }: { size: number }) {
  const glyph = Math.max(8, Math.round(size * 0.32));
  return (
    <span
      className="rakazo-jewel-monitor pointer-events-none absolute -bottom-0.5 -end-0.5 grid place-items-center rounded-[3px] border border-background bg-foreground text-background"
      style={{ width: glyph, height: glyph }}
    >
      <svg viewBox="0 0 12 12" width={glyph - 3} height={glyph - 3} fill="none">
        <rect x="1.5" y="2" width="9" height="6" rx="1" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 10.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
