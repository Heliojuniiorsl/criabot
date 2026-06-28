import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, Pencil, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAdminSession } from "@/lib/api/auth.functions";

export const Route = createFileRoute("/_authenticated/painel/perfil")({
  component: PerfilPage,
});

function PerfilPage() {
  const sessionFn = useServerFn(getAdminSession);
  const sessionQuery = useQuery({
    queryKey: ["admin-session"],
    queryFn: () => sessionFn(),
  });

  const admin = sessionQuery.data?.admin;
  const name = admin?.email?.split("@")[0] ?? "Usuario";
  const email = admin?.email ?? "Carregando...";
  const role = admin?.role === "admin" ? "Administrador" : "Creator";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Perfil</h1>
        <p className="mt-2 text-muted-foreground">Dados basicos da sua conta no CriaBot.</p>
      </div>

      <Card className="border bg-white/90 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
              <UserRound className="h-8 w-8" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold">{name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{role}</p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => toast.info("Edicao de perfil entra na proxima etapa.")}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Editar perfil
          </Button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <ProfileInfo title="Nome" value={name} icon={UserRound} />
          <ProfileInfo title="E-mail" value={email} icon={Mail} />
          <ProfileInfo title="Plano atual" value={role} icon={ShieldCheck} />
        </div>
      </Card>
    </div>
  );
}

function ProfileInfo({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-3 text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <p className="mt-1 break-words font-semibold">{value}</p>
    </div>
  );
}
