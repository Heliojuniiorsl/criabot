import { type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeftRight,
  BarChart3,
  CreditCard,
  Gift,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessagesSquare,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { logoutAdminAccount } from "@/lib/api/auth.functions";
import { ManagedBotContext, type ManagedBotPanel } from "@/lib/managed-bot-context";
import { cn } from "@/lib/utils";

const salesNav = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "planos", label: "Planos", icon: CreditCard },
  { page: "ofertas", label: "Ofertas e combos", icon: Gift },
  { page: "mensagens", label: "Mensagens automáticas", icon: Megaphone },
  { page: "grupos", label: "Grupos", icon: MessagesSquare },
  { page: "clientes", label: "Clientes", icon: Users },
  { page: "pedidos", label: "Pedidos", icon: ReceiptText },
  { page: "configuracoes", label: "Configurações", icon: Settings },
] as const;

const mediaNav = [
  { page: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { page: "planos", label: "Planos Premium", icon: CreditCard },
  { page: "usuarios", label: "Usuários", icon: Users },
  { page: "pagamentos", label: "Pagamentos", icon: CreditCard },
  { page: "grupos", label: "Grupos", icon: MessagesSquare },
  { page: "estatisticas", label: "Estatísticas", icon: BarChart3 },
  { page: "administracao", label: "Administração", icon: ShieldCheck },
  { page: "configuracoes", label: "Configurações", icon: Settings },
] as const;

export function AdminLayout({ bot, children }: { bot: ManagedBotPanel; children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const logoutFn = useServerFn(logoutAdminAccount);
  const nav = bot.kind === "images" ? mediaNav : salesNav;

  async function signOut() {
    await logoutFn();
    await navigate({ to: "/" });
  }

  return (
    <ManagedBotContext.Provider value={bot}>
      <div className="fixed inset-0 flex overflow-hidden bg-background">
        <aside className="hidden h-dvh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
          <BrandMark
            className="border-b border-sidebar-border px-2 pb-4 pt-2"
            imageClassName="h-10 w-10 rounded-xl"
            subtitle="Painel de bots"
          />

          <div className="mt-4 flex items-center gap-3 rounded-3xl border bg-background/70 px-3 py-3">
            {bot.photo_data_url ? (
              <img
                src={bot.photo_data_url}
                alt={`Foto de ${bot.display_name}`}
                className="h-10 w-10 rounded-xl object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                {bot.display_name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-semibold">{bot.display_name}</div>
              <div className="truncate text-xs text-muted-foreground">@{bot.username}</div>
            </div>
          </div>
          <nav className="mt-4 flex-1 space-y-1">
            <a
              href="/painel"
              className="flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <LayoutDashboard className="h-4 w-4" /> Painel
            </a>
            <a
              href="/painel/bots"
              className="flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <ArrowLeftRight className="h-4 w-4" /> Trocar bot
            </a>
            {nav.map((item) => {
              const target = `/${bot.username}/${item.page}`;
              const active = pathname === target;
              return (
                <Link
                  key={item.page}
                  to={target}
                  className={cn(
                    "flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <Button variant="ghost" className="justify-start" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <BrandMark compact imageClassName="h-8 w-8 rounded-lg" />
              {bot.photo_data_url ? (
                <img src={bot.photo_data_url} alt="" className="h-8 w-8 rounded-lg object-cover" />
              ) : null}
              <span className="truncate font-display font-semibold">{bot.display_name}</span>
            </div>
          </header>
          <nav className="sticky top-[57px] z-20 flex gap-1 overflow-x-auto overscroll-x-contain border-b border-border bg-background/95 px-2 py-2 backdrop-blur md:hidden">
            <a
              href="/painel"
              className="shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium text-muted-foreground"
            >
              Painel
            </a>
            <a
              href="/painel/bots"
              className="shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium text-muted-foreground"
            >
              Trocar bot
            </a>
            {nav.map((item) => {
              const target = `/${bot.username}/${item.page}`;
              return (
                <Link
                  key={item.page}
                  to={target}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium",
                    pathname === target
                      ? "bg-sidebar-accent text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#fafafa] p-3 pb-8 sm:p-4 md:p-8">
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </main>
        </div>
      </div>
    </ManagedBotContext.Provider>
  );
}
