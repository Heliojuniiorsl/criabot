import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  LayoutDashboard,
  Plus,
  RadioTower,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getManagedBots } from "@/lib/api/admin.functions";
import { getAdminSession } from "@/lib/api/auth.functions";

export const Route = createFileRoute("/_authenticated/painel/dashboard")({
  component: DashboardPage,
});

type ManagedBot = {
  key: string;
  kind: "sales" | "images";
  is_custom: boolean;
  display_name: string;
  configured: boolean;
  username: string | null;
  photo_data_url: string | null;
  pending_updates: number;
  status: "online" | "stopped" | "error" | "not_configured";
  status_message: string | null;
};

const statusLabel: Record<ManagedBot["status"], string> = {
  online: "Online",
  stopped: "Parado",
  error: "Erro",
  not_configured: "Nao configurado",
};

const statusClass: Record<ManagedBot["status"], string> = {
  online: "bg-emerald-100 text-emerald-700",
  stopped: "bg-slate-200 text-slate-700",
  error: "bg-red-100 text-red-700",
  not_configured: "bg-amber-100 text-amber-700",
};

function DashboardPage() {
  const botsFn = useServerFn(getManagedBots);
  const sessionFn = useServerFn(getAdminSession);

  const botsQuery = useQuery({
    queryKey: ["managed-bots"],
    queryFn: () => botsFn() as Promise<ManagedBot[]>,
    refetchInterval: 20_000,
    retry: 1,
  });

  const sessionQuery = useQuery({
    queryKey: ["admin-session"],
    queryFn: () => sessionFn(),
  });

  const bots = botsQuery.data ?? [];
  const onlineBots = bots.filter((bot) => bot.status === "online").length;
  const errorBots = bots.filter((bot) => bot.status === "error").length;
  const pendingUpdates = bots.reduce((total, bot) => total + Number(bot.pending_updates || 0), 0);
  const firstName = sessionQuery.data?.admin?.email?.split("@")[0] ?? "criador";

  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden border bg-white/90 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4" />
            Bem-vindo ao painel CriaBot
          </div>
          <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-[#202124] sm:text-5xl">
            Olá, {firstName}. Controle seus bots em um só lugar.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Acompanhe status, crie novos bots e entre rapidamente no painel de cada operação.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link to="/painel/bots">
                Abrir bots
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/painel/bots">
                <Plus className="mr-2 h-4 w-4" />
                Criar novo bot
              </Link>
            </Button>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard
            title="Total de bots"
            value={bots.length}
            helper="bots cadastrados"
            icon={Bot}
          />
          <SummaryCard
            title="Bots ativos"
            value={onlineBots}
            helper="webhooks online"
            icon={RadioTower}
          />
          <SummaryCard
            title="Bots com erro"
            value={errorBots}
            helper="precisam de atencao"
            icon={AlertCircle}
          />
          <SummaryCard
            title="Atualizacoes pendentes"
            value={pendingUpdates}
            helper="fila do Telegram"
            icon={LayoutDashboard}
          />
        </div>
      </section>

      <Card className="border bg-white/90 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold">Bots recentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Acesse rapidamente um painel ou veja todos em Bots.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/painel/bots">Ver todos</Link>
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {botsQuery.isLoading && (
            <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Consultando bots no Telegram...
            </div>
          )}
          {botsQuery.isError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Nao consegui carregar os bots agora.
            </div>
          )}
          {!botsQuery.isLoading && !botsQuery.isError && bots.length === 0 && (
            <div className="rounded-2xl border border-dashed p-6 text-center">
              <Bot className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 font-semibold">Nenhum bot cadastrado ainda</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Comece criando o primeiro bot na aba Bots.
              </p>
            </div>
          )}
          {bots.slice(0, 5).map((bot) => (
            <div
              className="flex flex-col gap-3 rounded-2xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
              key={bot.key}
            >
              <div className="flex min-w-0 items-center gap-3">
                {bot.photo_data_url ? (
                  <img
                    src={bot.photo_data_url}
                    alt={`Foto de ${bot.display_name}`}
                    className="h-12 w-12 rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Bot className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold">{bot.display_name}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {bot.username ? `@${bot.username}` : bot.status_message}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass[bot.status]}`}
                >
                  {statusLabel[bot.status]}
                </span>
                {bot.username ? (
                  <Button asChild size="sm">
                    <Link to="/$bot/dashboard" params={{ bot: bot.username }}>
                      Abrir
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string;
  value: number;
  helper: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="border bg-white/90 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-4 font-display text-4xl font-semibold">{value}</div>
      <p className="mt-1 text-sm text-muted-foreground">{helper}</p>
    </Card>
  );
}
