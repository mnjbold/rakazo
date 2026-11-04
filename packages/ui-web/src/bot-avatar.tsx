import type { BotAvatarSet } from "@rakazo/contracts";
import type {
  AvatarEyes,
  BotAttention,
  BotColorDef,
  BotMood,
  LogoAvatarActivity,
} from "@rakazo/core";
import {
  ACTIVE_RUN_STATUSES,
  avatarEyeRects,
  avatarIdentitySeed,
  BOT_AVATAR_COLORS,
  BOT_COLOR_LIST,
  botEyeTone,
  DEFAULT_BOT_AVATAR_COLOR,
  deriveBotMood,
  JEWL_MARK,
  ORGANIC_AVATAR_EYES,
  ORGANIC_AVATAR_VIEWBOX,
  organicAvatarEyeTilt,
  organicAvatarPath,
  PRODUCT_NAME,
  resolvePersonaColorDef,
  SHIPPED_BOT_AVATAR_EYES,
  SHIPPED_BOT_AVATAR_SHAPE_KEYS,
  SHIPPED_BOT_AVATAR_SHAPES,
  SHIPPED_BOT_AVATAR_VIEWBOX,
  shippedBotAvatarShapePath,
} from "@rakazo/core";
import type { ComponentProps, CSSProperties } from "react";
import { memo, useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { AvatarStyle } from "./avatar-style.js";
import { useAvatarStyle } from "./avatar-style.js";
import { useBotAvatarActivity } from "./bot-avatar-activity.js";
import { useAvatarMotionVisibility } from "./hooks/use-avatar-motion-visibility.js";
import { JewelAvatar } from "./jewel-avatar.js";
import { cn } from "./lib/utils.js";
import { LogoAvatar } from "./logo-avatar.js";
import "./styles.css";

export type { BotColorDef };
export { BOT_AVATAR_COLORS, BOT_COLOR_LIST, DEFAULT_BOT_AVATAR_COLOR, resolvePersonaColorDef };

export const BOT_SHAPES = SHIPPED_BOT_AVATAR_SHAPES;
export const SHIPPED_SHAPE_KEYS = SHIPPED_BOT_AVATAR_SHAPE_KEYS;
const VIEWBOX = SHIPPED_BOT_AVATAR_VIEWBOX;

export const BOT_MASCOT_SHAPES = SHIPPED_SHAPE_KEYS.map(
  (k) => BOT_SHAPES[k] ?? FALLBACK_SHAPE_PATH,
);

const FALLBACK_SHAPE_PATH = BOT_SHAPES.hex ?? "";

export function parseBotAvatar(
  rawColor: string,
  _identity?: string,
): {
  color: string;
  shapeIndex?: number;
  isImage: boolean;
  imageUrl?: string;
} {
  if (!rawColor) return { color: "#F97316", isImage: false };
  // Only data: image URLs are rendered. Arbitrary http(s)/blob values in `color`
  // must not become <img src> (SSRF / tracking when other members view the bot).
  if (rawColor.startsWith("data:image/")) {
    return { color: "#F97316", isImage: true, imageUrl: rawColor };
  }
  if (rawColor.includes("::shape_")) {
    const parts = rawColor.split("::shape_");
    const rawShapeIdx = parts[1] ?? "0";
    const parsedShapeIdx = /^\d+$/.test(rawShapeIdx) ? Number(rawShapeIdx) : 0;
    const shapeIdx = Number.isSafeInteger(parsedShapeIdx) ? parsedShapeIdx : 0;
    return {
      color: parts[0] || "#F97316",
      shapeIndex: shapeIdx % SHIPPED_SHAPE_KEYS.length,
      isImage: false,
    };
  }
  return { color: rawColor, isImage: false };
}

const AVATAR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultBotAvatarValue(rawColor: string): string {
  const parsed = parseBotAvatar(rawColor);
  if (rawColor && !parsed.isImage && AVATAR_HEX.test(parsed.color)) return parsed.color;
  return DEFAULT_BOT_AVATAR_COLOR;
}

export interface BotAvatarProps {
  color: string;
  avatarSet?: BotAvatarSet;
  activity?: LogoAvatarActivity;
  size?: number;
  status?: string;
  /** Server-derived attention for bots whose thread is not open. */
  attention?: BotAttention | null;
  /** Live mood from the open thread; derived from `status` and `attention` when omitted. */
  mood?: BotMood;
  onComputer?: boolean;
  computerOpen?: boolean;
  /** Pointer reactions on the jewel (header avatar). */
  interactive?: boolean;
  identity?: string;
  className?: string;
  /** Overrides the account's avatar style (JEWL jewel characters by default). */
  variant?: AvatarStyle;
}

export const BotAvatar = memo(function BotAvatar({
  color,
  avatarSet,
  activity,
  size = 36,
  status,
  attention,
  mood: liveMood,
  onComputer,
  computerOpen,
  interactive,
  identity = "",
  className,
  variant,
}: BotAvatarProps) {
  const preferredVariant = useAvatarStyle();
  const id = useId().replace(/[^a-zA-Z0-9-_]/g, "");
  const derived = deriveBotMood({ runStatus: status, attention, now: 0 });
  const mood = liveMood ?? derived.mood;
  // Waiting on the person is not work: those runs show the attention badge instead.
  const isWorking = mood === "working" || mood === "thinking" || mood === "trying_hard";
  const badge = mood === "needs_you" || mood === "error" ? mood : null;

  const parsed = useMemo(() => parseBotAvatar(color, identity), [color, identity]);
  const effectiveId = identity || parsed.color || "agent";

  const colorDef = useMemo(
    () => resolvePersonaColorDef(effectiveId, parsed.color),
    [effectiveId, parsed.color],
  );

  if (parsed.isImage && parsed.imageUrl) {
    return (
      <div
        className={cn("rakazo-bot-avatar relative shrink-0 select-none", className)}
        data-working={isWorking}
        data-attention={badge ?? undefined}
        style={{ width: size, height: size }}
      >
        <div className="rakazo-bot-avatar-picture relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-secondary">
          <img src={parsed.imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
        {isWorking ? (
          <svg
            className="rakazo-bot-avatar-ring rakazo-bot-avatar-ring-working absolute pointer-events-none"
            style={{ inset: 0, width: size, height: size }}
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="24"
              cy="24"
              r="22"
              className="stroke-status-working"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeDasharray="45 80"
            />
          </svg>
        ) : null}
        <AttentionBadge attention={badge} size={size} />
      </div>
    );
  }

  if (parsed.shapeIndex === undefined && (variant ?? preferredVariant) === "jewel") {
    return (
      <JewelAvatar
        colorDef={colorDef}
        identity={effectiveId}
        size={size}
        mood={mood}
        onComputer={onComputer ?? derived.onComputer}
        computerOpen={computerOpen}
        interactive={interactive}
        attention={badge}
        className={className}
      />
    );
  }

  if (parsed.shapeIndex === undefined && avatarSet === "rakazo") {
    const Avatar = activity === undefined ? LiveLogoAvatar : LogoAvatar;
    return (
      <Avatar
        avatarValue={color ? colorDef.hex : undefined}
        identity={effectiveId}
        size={size}
        activity={activity}
        status={status}
        className={className}
      />
    );
  }
  if (parsed.shapeIndex === undefined) {
    return (
      <OrganicAvatar
        color={colorDef.hex}
        identity={effectiveId}
        size={size}
        isWorking={isWorking}
        attention={badge}
        className={className}
      />
    );
  }

  return (
    <div
      className={cn(
        "rakazo-bot-avatar bot-avatar-container relative inline-flex items-center justify-center shrink-0 select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
      }}
      data-working={isWorking}
      data-attention={badge ?? undefined}
    >
      <svg
        className="rakazo-bot-avatar-ring absolute pointer-events-none"
        // Working state stays inside the idle footprint: the ring is drawn within the box.
        style={{
          inset: 0,
          width: size,
          height: size,
          filter: `drop-shadow(0 0 1.5px ${colorDef.hex})`,
        }}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="24"
          cy="24"
          r="22"
          stroke={`url(#${id}-ring)`}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray="45 80"
        />
        <circle cx="43" cy="24" r="2.8" fill="#ffffff" />
        <defs>
          <linearGradient id={`${id}-ring`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="60%" stopColor={colorDef.hex} stopOpacity="0.9" />
            <stop offset="100%" stopColor={colorDef.hex} stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <svg
        viewBox={VIEWBOX}
        aria-hidden="true"
        className={cn(
          "overflow-visible transition-transform duration-300",
          isWorking
            ? "animate-pulse scale-[0.8] motion-reduce:animate-none"
            : "hover:scale-[1.03] motion-reduce:hover:scale-100",
        )}
        // Inline size so a parent's icon sizing (Button sizes bare SVGs) cannot shrink it.
        style={{
          width: size,
          height: size,
          filter: isWorking
            ? `drop-shadow(0 0 2px ${colorDef.hex})`
            : "drop-shadow(0 2px 4px rgba(0,0,0,0.45))",
        }}
      >
        <g>
          <path d={shippedBotAvatarShapePath(parsed.shapeIndex)} fill={colorDef.hex} />
          <g className={cn("bot-character-eyes", eyeFill(colorDef.hex))}>
            <BarEyes eyes={SHIPPED_BOT_AVATAR_EYES} />
          </g>
        </g>
      </svg>
      <AttentionBadge attention={badge} size={size} />
    </div>
  );
});

/** One dot for needs-you or error; the row label names the state for assistive tech. */
function AttentionBadge({ attention, size }: { attention: BotAttention | null; size: number }) {
  if (!attention) return null;
  const dot = Math.max(7, Math.round(size * 0.26));
  return (
    <span
      aria-hidden="true"
      data-attention-badge={attention}
      className={cn(
        "pointer-events-none absolute end-0 top-0 z-20 rounded-full border-2 border-background",
        attention === "error" ? "bg-destructive" : "bg-warning",
      )}
      style={{ width: dot, height: dot }}
    />
  );
}

/** Only live Rakazo consumers subscribe to public activity updates. */
function LiveLogoAvatar({
  status,
  ...props
}: ComponentProps<typeof LogoAvatar> & { status?: string }) {
  const activity = useBotAvatarActivity(props.identity ?? "", status);
  return <LogoAvatar {...props} activity={activity} />;
}

function OrganicAvatar({
  color,
  identity,
  size,
  isWorking,
  attention,
  className,
}: {
  color: string;
  identity?: string;
  size: number;
  isWorking: boolean;
  attention: BotAttention | null;
  className?: string;
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
  const { ref, visible } = useAvatarMotionVisibility(!reducedMotion);
  useEffect(() => {
    // jsdom has no SMIL clock, so these are optional.
    if (visible) ref.current?.unpauseAnimations?.();
    else ref.current?.pauseAnimations?.();
  }, [ref, visible]);
  const seed = avatarIdentitySeed(identity || color || DEFAULT_BOT_AVATAR_COLOR);
  const duration = `${4.8 + (seed % 24) / 10}s`;
  const shapeA = organicAvatarPath(seed);
  const shapeB = organicAvatarPath(seed, 0.42);

  const picture = (
    <svg
      ref={ref}
      viewBox={ORGANIC_AVATAR_VIEWBOX}
      aria-hidden="true"
      className={cn("rakazo-organic-avatar overflow-visible select-none", className)}
      data-working={isWorking}
      data-paused={!visible}
      data-shape-family={seed % 10}
      data-eye-pattern={seed % 4}
      style={{
        width: size,
        height: size,
        flex: "none",
      }}
    >
      <g transform={isWorking ? "scale(0.9)" : undefined}>
        {(["idle", "working"] as const).map((mode) => (
          <path
            key={mode}
            className={`rakazo-organic-avatar-body rakazo-organic-avatar-body-${mode}`}
            d={shapeA}
            fill={color}
            style={
              {
                "--rakazo-organic-path": `path("${shapeA}")`,
                filter:
                  mode === "working"
                    ? `drop-shadow(0 0 ${Math.max(1, Math.round(size * 0.05))}px ${color})`
                    : "drop-shadow(0 2px 3px rgba(0,0,0,.34))",
              } as CSSProperties
            }
          >
            {!reducedMotion ? (
              <animate
                attributeName="d"
                values={`${shapeA};${shapeB};${shapeA}`}
                dur={duration}
                repeatCount="indefinite"
              />
            ) : null}
          </path>
        ))}
        <g transform={`rotate(${organicAvatarEyeTilt(seed)})`}>
          {(["idle", "working"] as const).map((mode) => (
            <g
              key={mode}
              className={`rakazo-organic-avatar-eyes rakazo-organic-avatar-eyes-${mode} ${eyeFill(color)}`}
            >
              <rect x="-14" y="-12" width="7" height="24" rx="3.5" />
              <rect x="7" y="-12" width="7" height="24" rx="3.5" />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
  if (!attention) return picture;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {picture}
      <AttentionBadge attention={attention} size={size} />
    </span>
  );
}

function BarEyes({ eyes }: { eyes: AvatarEyes }) {
  return avatarEyeRects(eyes).map((rect) => <rect key={rect.x} {...rect} />);
}

/** Eyes are cut-outs in the page color unless the body is nearly white or black. */
function eyeFill(bodyHex: string): string {
  const tone = botEyeTone(bodyHex);
  if (tone === "dark") return "fill-foreground dark:fill-background";
  if (tone === "light") return "fill-background dark:fill-foreground";
  return "fill-background";
}

const reducedMotionMedia = "(prefers-reduced-motion: reduce)";

function reducedMotionSnapshot(): boolean {
  return window.matchMedia(reducedMotionMedia).matches;
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia(reducedMotionMedia);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function BotShapePreview({
  shapeIndex,
  identity,
  label,
  color,
  selected,
  onClick,
}: {
  /** An Avatar Studio shape; omit it to draw the organic body `identity` gets. */
  shapeIndex?: number;
  identity?: string;
  label?: string;
  color: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const key =
    shapeIndex === undefined
      ? undefined
      : (SHIPPED_SHAPE_KEYS[shapeIndex % SHIPPED_SHAPE_KEYS.length] ?? "hex");
  const colorDef = resolvePersonaColorDef("preview", color);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? key}
      aria-pressed={selected ?? false}
      className={cn(
        "relative flex size-11 items-center justify-center rounded-xl transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
        selected
          ? "ring-2 ring-primary ring-offset-2 ring-offset-popover bg-white/10"
          : "hover:bg-white/5",
      )}
    >
      {shapeIndex === undefined ? (
        <BotAvatar color={color} identity={identity} size={32} />
      ) : (
        <svg viewBox={VIEWBOX} className="size-8 overflow-visible" aria-hidden="true">
          <path d={shippedBotAvatarShapePath(shapeIndex)} fill={colorDef.hex} />
          <g className={eyeFill(colorDef.hex)}>
            <BarEyes eyes={SHIPPED_BOT_AVATAR_EYES} />
          </g>
        </svg>
      )}
    </button>
  );
}

/**
 * The JEWL mark: a cut gem whose two eye facets make it an agent. Paints in currentColor.
 * `glow` sets it on a soft brand halo for entry screens; size the wrapper through `className`.
 */
export function JewlMark({
  className,
  title,
  glow,
}: {
  className?: string;
  title?: string;
  glow?: boolean;
}) {
  if (glow) {
    return (
      <div className={cn("relative grid size-11 place-items-center", className)}>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[90%] rounded-full bg-radial from-brand/20 via-brand/5 via-40% to-transparent to-70% motion-safe:animate-in motion-safe:fade-in motion-safe:duration-1000"
        />
        <JewlMark title={title} className="relative size-full" />
      </div>
    );
  }
  return (
    <svg
      viewBox={JEWL_MARK.viewBox}
      className={cn("size-11 text-brand", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-jewl-mark=""
    >
      <g
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={JEWL_MARK.strokeWidth}
        strokeLinejoin="round"
      >
        <path d={JEWL_MARK.crown} />
        <path fillRule="evenodd" d={JEWL_MARK.pavilion} />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <JewlMark className="size-11" />
      <span className="font-[Aeonik,ui-sans-serif] text-[28px] tracking-tight text-foreground">
        {PRODUCT_NAME}
      </span>
    </div>
  );
}
