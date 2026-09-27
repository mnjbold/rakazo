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

  return (
    <div
      data-testid="message-hover-rail"
      className={`absolute top-1/2 z-10 flex -translate-y-1/2 items-center transition-opacity ${reveal} ${
        side === "end" ? "start-full ms-1" : "end-full me-1"
      }`}
    >
      {children}
    </div>
  );
}
