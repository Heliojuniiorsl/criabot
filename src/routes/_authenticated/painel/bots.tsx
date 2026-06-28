import { createFileRoute } from "@tanstack/react-router";

import { BotsPanelContent } from "@/routes/_authenticated/bots";

export const Route = createFileRoute("/_authenticated/painel/bots")({
  component: BotsPage,
});

function BotsPage() {
  return <BotsPanelContent embedded />;
}
