import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

const COLLAPSED_PX = 300;

/** Collapses a long reply to one screenful with a small toggle, so a chat never becomes a scroll of pages. */
export function ClampedText({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflows(element.scrollHeight > COLLAPSED_PX + 40);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clamped = overflows && !expanded;
  return (
    <>
      <div
        ref={ref}
        className="overflow-hidden"
        style={
          clamped
            ? {
                maxHeight: COLLAPSED_PX,
                maskImage: "linear-gradient(to bottom, black 70%, transparent)",
              }
            : undefined
        }
      >
        {children}
      </div>
      {overflows ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? t`Show less` : t`Show more`}
        </button>
      ) : null}
    </>
  );
}
