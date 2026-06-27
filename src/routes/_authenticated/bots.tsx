import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Images, LogOut, Play, RotateCw, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getManagedBots, runManagedBotAction } from "@/lib/api/admin.functions";
import { logoutAdminAccount } from "@/lib/api/auth.functions";

export const Route = createFileRoute("/_authenticated/bots")({
  component: Bots,
});

type ManagedBot = {
  key: string;
  kind: "sales" | "images";
  is_clone: boolean;
  display_name: string;
  panel_path: string | null;
  configured: boolean;
  telegram_name: string | null;
  username: string | null;
  photo_data_url: string | null;
  webhook_url: string | null;
  pending_updates: number;
  status: "online" | "stopped" | "error" | "not_configured";
  status_message: string | null;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

const statusLabels: Record<ManagedBot["status"], string> = {
  online: "Online",
  stopped: "Parado",
  error: "Erro",
  not_configured: "Não configurado",
};

const statusClasses: Record<ManagedBot["status"], string> = {
  online: "bg-emerald-100 text-emerald-700",
  stopped: "bg-slate-200 text-slate-700",
  error: "bg-red-100 text-red-700",
  not_configured: "bg-amber-100 text-amber-700",
};

function Bots() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logoutFn = useServerFn(logoutAdminAccount);
  const listFn = useServerFn(getManagedBots);
  const actionFn = useServerFn(runManagedBotAction);

  const botsQuery = useQuery({
    queryKey: ["managed-bots"],
    queryFn: () =>
      withTimeout(
        listFn() as Promise<ManagedBot[]>,
        15_000,
        "A consulta ao Telegram demorou demais. Tente novamente em alguns segundos.",
      ),
    refetchInterval: 15_000,
    retry: 1,
  });

  const action = useMutation({
    mutationFn: (data: { key: ManagedBot["key"]; action: "start" | "stop" | "restart" }) =>
      actionFn({ data }) as Promise<{ status_message?: string | null }>,
    onSuccess: async (result, variables) => {
      await qc.invalidateQueries({ queryKey: ["managed-bots"] });
      const messages = {
        start: "Bot iniciado",
        stop: "Bot parado",
        restart: "Bot reiniciado",
      };
      toast.success(result.status_message || messages[variables.action]);
    },
    onError: (error: any) => toast.error(error.message),
  });

  async function signOut() {
    await logoutFn();
    await navigate({ to: "/" });
  }

  const bots = botsQuery.data ?? [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-start px-4 py-6 sm:px-5 sm:py-12 md:justify-center">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-display text-lg font-semibold">
            Premium<span className="text-primary">Studio</span>
          </div>
          <h1 className="mt-6 font-display text-3xl font-semibold leading-tight sm:mt-8 sm:text-4xl">
            Escolha qual bot deseja gerenciar
          </h1>
          <p className="mt-2 text-muted-foreground">
            Cada bot tem painel e banco proprios. Nome, foto e usuario sao atualizados
            automaticamente pelo Telegram.
          </p>
        </div>
        <Button variant="ghost" className="self-start sm:self-auto" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sair
        </Button>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {botsQuery.isLoading && (
          <Card className="col-span-full p-8 text-center text-muted-foreground">
            Consultando os bots no Telegram...
          </Card>
        )}
        {botsQuery.isError && (
          <Card className="col-span-full p-8 text-center">
            <p className="font-semibold text-destructive">Não consegui consultar os bots agora.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {botsQuery.error instanceof Error
                ? botsQuery.error.message
                : "Falha ao carregar a lista de bots."}
            </p>
            <Button className="mt-5" onClick={() => botsQuery.refetch()}>
              Tentar novamente
            </Button>
          </Card>
        )}
        {bots.map((bot) => {
          const Icon = bot.kind === "sales" ? Bot : Images;
          const busy = action.isPending && action.variables?.key === bot.key;
          return (
            <Card key={bot.key} className="flex h-full flex-col p-5 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  {bot.photo_data_url ? (
                    <img
                      src={bot.photo_data_url}
                      alt={`Foto de ${bot.display_name}`}
                      className="h-16 w-16 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Icon className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[bot.status]}`}
                >
                  {statusLabels[bot.status]}
                </span>
              </div>

              <h2 className="mt-5 font-display text-2xl font-semibold">{bot.display_name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {bot.username ? `@${bot.username}` : bot.status_message}
              </p>
              {bot.username && bot.status_message && (
                <p
                  className={`mt-2 text-xs ${
                    bot.status === "error" ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {bot.status_message}
                </p>
              )}
              {bot.pending_updates > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {bot.pending_updates} atualização(ões) aguardando processamento
                </p>
              )}

              <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  variant="outline"
                  disabled={!bot.configured || bot.status === "online" || busy}
                  onClick={() => action.mutate({ key: bot.key, action: "start" })}
                >
                  <Play className="mr-1 h-4 w-4" /> Iniciar
                </Button>
                <Button
                  variant="outline"
                  disabled={!bot.configured || bot.status === "stopped" || busy}
                  onClick={() => action.mutate({ key: bot.key, action: "stop" })}
                >
                  <Square className="mr-1 h-4 w-4" /> Parar
                </Button>
                <Button
                  variant="outline"
                  disabled={!bot.configured || busy}
                  onClick={() => action.mutate({ key: bot.key, action: "restart" })}
                >
                  <RotateCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Reiniciar
                </Button>
              </div>

              {bot.username ? (
                <Button asChild className="mt-5 w-full">
                  <Link to="/$bot/dashboard" params={{ bot: bot.username }}>
                    Abrir painel
                  </Link>
                </Button>
              ) : (
                <Button className="mt-5 w-full" disabled>
                  Configure o token para abrir
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </main>
  );
}
