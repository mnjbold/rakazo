import type { ReactNode } from "react";

export function MessageHoverMetadata({
  side,
  pinned = false,
  children,
}: {
  side: "start" | "end";
  pinned?: boolean;
  children: ReactNode;
}) {
  // Hover-capable pointers reveal the rail on hover; touch reveals it for the
  // message the transcript marks open (long-press or tap on the bubble).
  const reveal = pinned
    ? "pointer-events-auto opacity-100"
    : "pointer-events-none opacity-0 group-data-[touch-actions=open]/message:pointer-events-auto group-data-[touch-actions=open]/message:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover/message:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:group-hover/message:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-within:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:focus-within:opacity-100";

  // Touch: a small pill under the bubble, so bubbles can use the full width.
  // Hover pointers: beside the bubble, in the gutter the bubble leaves free.
  const placement =
    side === "end"
      ? "start-0 [@media(hover:hover)_and_(pointer:fine)]:start-full [@media(hover:hover)_and_(pointer:fine)]:ms-1"
      : "end-0 [@media(hover:hover)_and_(pointer:fine)]:end-full [@media(hover:hover)_and_(pointer:fine)]:me-1";
  return (
    <div
      data-testid="message-hover-rail"
      className={`absolute top-full z-10 mt-1 flex items-center rounded-full border border-border bg-popover px-1 shadow-sm transition-opacity [@media(hover:hover)_and_(pointer:fine)]:top-1/2 [@media(hover:hover)_and_(pointer:fine)]:mt-0 [@media(hover:hover)_and_(pointer:fine)]:-translate-y-1/2 [@media(hover:hover)_and_(pointer:fine)]:border-0 [@media(hover:hover)_and_(pointer:fine)]:bg-transparent [@media(hover:hover)_and_(pointer:fine)]:px-0 [@media(hover:hover)_and_(pointer:fine)]:shadow-none ${reveal} ${placement}`}
    >
      {children}
    </div>
  );
}
