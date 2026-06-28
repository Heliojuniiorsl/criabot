import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";

import { BotsPanelContent } from "@/routes/_authenticated/bots";

export const Route = createFileRoute("/_authenticated/painel/bots")({
  component: BotsPage,
});

function BotsPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname !== "/painel/bots") {
    return <Outlet />;
  }

  return <BotsPanelContent embedded />;
}
