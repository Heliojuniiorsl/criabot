import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboard } from "@/lib/api/admin.functions";
import { Card } from "@/components/ui/card";
import { TrendingUp, CalendarDays, Users, AlertTriangle, Clock } from "lucide-react";

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const fn = useServerFn(getDashboard);
  const { data } = useSuspenseQuery(queryOptions({ queryKey: ["dashboard"], queryFn: () => fn() }));

  const cards = [
    { label: "Vendas do dia", value: brl(data.salesToday), icon: TrendingUp },
    { label: "Vendas do mês", value: brl(data.salesMonth), icon: CalendarDays },
    { label: "Assinantes ativos", value: String(data.activeSubscribers), icon: Users },
    {
      label: "Assinaturas vencidas",
      value: String(data.expiredSubscriptions),
      icon: AlertTriangle,
    },
    { label: "Pagamentos pendentes", value: String(data.pendingPayments), icon: Clock },
  ];

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Resumo do seu negócio.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{c.label}</span>
              <c.icon className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-4 font-display text-3xl font-semibold">{c.value}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
