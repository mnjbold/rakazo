import { BotAvatar } from "@rakazo/ui-web";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <div style={{ display: "flex", gap: 24, padding: 24 }}>
    <BotAvatar color="#D9508A" identity="reduced-motion" size={120} status="running" />
    <BotAvatar
      color="#D9508A"
      identity="organic-working"
      size={120}
      status="running"
      variant="organic"
    />
  </div>,
);
