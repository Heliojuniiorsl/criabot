import { useEffect } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getManagedBots } from "@/lib/api/admin.functions";
import type { ManagedBotPanel } from "@/lib/managed-bot-context";

export const Route = createFileRoute("/_authenticated/$bot")({
  component: ManagedBotRoute,
});

type ManagedBotResponse = ManagedBotPanel & {
  configured: boolean;
  username: string | null;
};

function ManagedBotRoute() {
  const { bot: routeUsername } = Route.useParams();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const listFn = useServerFn(getManagedBots);
  const botsQuery = useQuery({
    queryKey: ["managed-bots"],
    queryFn: () => listFn() as Promise<ManagedBotResponse[]>,
    refetchInterval: 60_000,
  });
  const bot = botsQuery.data?.find(
    (item) => item.username?.toLowerCase() === routeUsername.toLowerCase(),
  );
  const canonicalPath = bot?.username ? `/${bot.username}/dashboard` : null;
  const imageBotAllowedPaths = bot?.username
    ? [
        `/${bot.username}/dashboard`,
        `/${bot.username}/planos`,
        `/${bot.username}/usuarios`,
        `/${bot.username}/pagamentos`,
        `/${bot.username}/grupos`,
        `/${bot.username}/estatisticas`,
        `/${bot.username}/administracao`,
        `/${bot.username}/configuracoes`,
      ]
    : [];
  const redirectToDashboard = Boolean(
    bot?.kind === "images" && canonicalPath && !imageBotAllowedPaths.includes(pathname),
  );

  useEffect(() => {
    if (redirectToDashboard && bot?.username) {
      void navigate({ to: "/$bot/dashboard", params: { bot: bot.username }, replace: true });
    }
  }, [bot?.username, navigate, redirectToDashboard]);

  if (botsQuery.isLoading || redirectToDashboard) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando painel do bot...</div>;
  }

  if (!bot?.username) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#fafafa] p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">Bot não encontrado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            O endereço não corresponde a nenhum bot configurado neste painel.
          </p>
          <Button asChild className="mt-6">
            <Link to="/painel">Voltar para o painel</Link>
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <AdminLayout bot={{ ...bot, username: bot.username }}>
      <Outlet />
    </AdminLayout>
  );
}
