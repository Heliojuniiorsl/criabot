import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, LayoutDashboard, LogOut, Menu, Settings, UserRound, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { logoutAdminAccount } from "@/lib/api/auth.functions";
import { cn } from "@/lib/utils";

const painelNav = [
  { to: "/painel/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/painel/bots", label: "Bots", icon: Bot },
  { to: "/painel/config", label: "Configuracao", icon: Settings },
  { to: "/painel/perfil", label: "Perfil", icon: UserRound },
] as const;

export function PainelLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const logoutFn = useServerFn(logoutAdminAccount);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function signOut() {
    await logoutFn();
    await navigate({ to: "/" });
  }

  const sidebar = (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <BrandMark subtitle="Area administrativa" imageClassName="h-10 w-10 rounded-xl" />
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar menu"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <nav className="mt-8 flex-1 space-y-2">
        {painelNav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
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
      </nav>

      <Button variant="ghost" className="justify-start rounded-2xl" onClick={signOut}>
        <LogOut className="mr-2 h-4 w-4" />
        Sair
      </Button>
    </aside>
  );

  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_15%_0%,rgba(26,115,232,.12),transparent_30rem),linear-gradient(180deg,#ffffff_0%,#f8fafd_100%)]">
      <div className="fixed inset-y-0 left-0 z-40 hidden md:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            aria-label="Fechar menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full">{sidebar}</div>
        </div>
      )}

      <div className="md:pl-72">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-white/85 px-4 py-3 backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <BrandMark compact imageClassName="h-9 w-9 rounded-xl" />
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="h-5 w-5" />
          </Button>
        </header>

        <main className="min-h-dvh p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
