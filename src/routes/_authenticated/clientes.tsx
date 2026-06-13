import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCustomers } from "@/lib/api/admin.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/clientes")({
  component: Clientes,
});

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

function Clientes() {
  const fn = useServerFn(listCustomers);
  const { data: customers } = useSuspenseQuery(
    queryOptions({ queryKey: ["customers"], queryFn: () => fn() as Promise<any[]> }),
  );

  const now = Date.now();

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Clientes</h1>
      <p className="mt-1 text-sm text-muted-foreground">Assinantes e compradores do bot.</p>

      <Card className="mt-8 p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>ID Telegram</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Nenhum cliente ainda.
                </TableCell>
              </TableRow>
            )}
            {customers.map((c) => {
              const active =
                c.subscription_status === "active" &&
                c.end_date &&
                new Date(c.end_date).getTime() > now;
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name ?? "—"}</TableCell>
                  <TableCell>{c.telegram_username ? `@${c.telegram_username}` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{c.telegram_id}</TableCell>
                  <TableCell>{c.plan_name ?? "—"}</TableCell>
                  <TableCell>{fmtDate(c.start_date)}</TableCell>
                  <TableCell>{fmtDate(c.end_date)}</TableCell>
                  <TableCell>
                    {c.subscription_status ? (
                      <Badge variant={active ? "default" : "destructive"}>
                        {active ? "Ativo" : "Vencido"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Sem plano</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
