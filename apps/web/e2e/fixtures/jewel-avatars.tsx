import type { BotAttention } from "@rakazo/contracts";
import type { BotMood } from "@rakazo/core";
import { BOT_MOODS } from "@rakazo/core";
import { AvatarStyleProvider, BotAvatar } from "@rakazo/ui-web";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

const NAMES = ["Ada", "Grace", "Linus", "Margaret", "Alan", "Hedy", "Barbara", "Ken", "Radia"];
const COLORS = ["#8B5CF6", "#10B981", "#F97316", "#EAB308", "#D9508A", "#3B82F6"];

const roster = Array.from({ length: 50 }, (_, index) => {
  const attention: BotAttention | null =
    index === 1 ? "needs_you" : index === 4 ? "error" : index === 7 ? "needs_you" : null;
  return {
    id: `bot-${index}`,
    name: `${NAMES[index % NAMES.length]} ${Math.floor(index / NAMES.length) + 1}`,
    color: COLORS[index % COLORS.length] ?? "#8B5CF6",
    status: index === 2 || index === 9 ? "running" : index === 1 ? "waiting_input" : "idle",
    attention,
  };
});

const label = (attention: BotAttention | null) =>
  attention === "needs_you" ? "needs you" : attention === "error" ? "failed" : null;

function MoodCell({ mood, onComputer }: { mood: BotMood; onComputer?: boolean }) {
  return (
    <figure
      data-testid={`jewel-${mood}${onComputer ? "-computer" : ""}`}
      className="flex flex-col items-center gap-2"
    >
      <div className="flex items-end gap-3">
        <BotAvatar
          color="#8B5CF6"
          identity="ada"
          size={78}
          mood={mood}
          onComputer={onComputer}
          computerOpen={onComputer}
          interactive
        />
        <BotAvatar color="#10B981" identity="grace" size={30} mood={mood} />
      </div>
      <figcaption className="text-[12px] text-muted-foreground">
        {mood}
        {onComputer ? " (computer)" : ""}
      </figcaption>
    </figure>
  );
}

createRoot(document.getElementById("root")!).render(
  <AvatarStyleProvider value="jewel">
    <div className="flex min-h-screen gap-6 bg-background p-6 text-foreground">
      <aside
        data-testid="jewel-sidebar"
        className="h-[640px] w-[280px] shrink-0 overflow-y-auto rounded-xl border border-sidebar-border bg-sidebar p-2"
      >
        {roster.map((bot) => (
          <button
            key={bot.id}
            type="button"
            data-roster-bot-id={bot.id}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start hover:bg-sidebar-accent"
          >
            <BotAvatar
              color={bot.color}
              identity={bot.id}
              size={30}
              status={bot.status}
              attention={bot.attention}
            />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
              {bot.name}
              {bot.attention ? <span className="sr-only">, {label(bot.attention)}</span> : null}
            </span>
          </button>
        ))}
      </aside>
      <section data-testid="jewel-moods" className="grid grid-cols-5 content-start gap-8">
        {BOT_MOODS.map((mood) => (
          <MoodCell key={mood} mood={mood} />
        ))}
        <MoodCell mood="working" onComputer />
      </section>
    </div>
  </AvatarStyleProvider>,
);
