import { createFileRoute } from "@tanstack/react-router";

import { BotsPanelContent } from "@/routes/_authenticated/bots";

export const Route = createFileRoute("/_authenticated/painel/bots/novo-bot")({
  component: NewBotPage,
});

function NewBotPage() {
  return <BotsPanelContent embedded mode="create" />;
}
