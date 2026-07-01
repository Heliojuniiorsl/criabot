import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, LayoutDashboard, LogOut, Menu, Settings, UserRound, X } from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { logoutAdminAccount } from "@/lib/api/auth.functions";
import { cn } from "@/lib/utils";

const painelNav = [
  { to: "/painel/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/painel/bots", label: "Bots", icon: Bot },
  { to: "/painel/config", label: "Configuração", icon: Settings },
  { to: "/painel/perfil", label: "Perfil", icon: UserRound },
] as const;

export function PainelHeader({ forceActiveTo }: { forceActiveTo?: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const logoutFn = useServerFn(logoutAdminAccount);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function signOut() {
    await logoutFn();
    await navigate({ to: "/" });
  }

  function isActive(to: string) {
    if (forceActiveTo) {
      return forceActiveTo === to;
    }
    return pathname === to || pathname.startsWith(`${to}/`);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 shadow-[0_10px_30px_rgba(17,17,17,0.05)] backdrop-blur">
      <div className="mx-auto flex min-h-20 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          to="/painel/dashboard"
          className="shrink-0 rounded-2xl outline-none transition focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setMobileOpen(false)}
        >
          <BrandMark subtitle="Área administrativa" imageClassName="h-10 w-10 rounded-xl" />
        </Link>

        <nav className="ml-auto hidden items-center gap-2 md:flex">
          {painelNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Button
          variant="ghost"
          className="hidden rounded-full font-semibold text-muted-foreground hover:text-primary md:inline-flex"
          onClick={signOut}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="ml-auto rounded-full md:hidden"
          onClick={() => setMobileOpen((value) => !value)}
          aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {mobileOpen ? (
        <div className="border-t border-border bg-background px-4 py-3 shadow-sm md:hidden">
          <nav className="mx-auto grid max-w-7xl gap-2">
            {painelNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              );
            })}
            <Button variant="ghost" className="justify-start rounded-2xl" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
