import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { hideOrder, listOrders, syncOrderPayment } from "@/lib/api/admin.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));
const fmtDate = (d: string) => new Date(d).toLocaleString("pt-BR");

export const Route = createFileRoute("/_authenticated/$bot/pedidos")({
  component: Pedidos,
});

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pendente", variant: "outline" },
  paid: { label: "Pago", variant: "default" },
  canceled: { label: "Cancelado", variant: "destructive" },
  expired: { label: "Expirado", variant: "secondary" },
};

function Pedidos() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOrders);
  const payFn = useServerFn(syncOrderPayment);
  const hideFn = useServerFn(hideOrder);

  const { data: orders } = useSuspenseQuery(
    queryOptions({ queryKey: ["orders"], queryFn: () => listFn() as Promise<any[]> }),
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  const pay = useMutation({
    mutationFn: (id: string) => payFn({ data: { id } }),
    onSuccess: () => {
      refresh();
      toast.success("Pagamento verificado");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const hide = useMutation({
    mutationFn: (id: string) => hideFn({ data: { id } }),
    onSuccess: () => {
      refresh();
      toast.success("Transacao removida da lista");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Pedidos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Os pagamentos são confirmados automaticamente pelo Mercado Pago.
      </p>

      <Card className="mt-8 p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Produto/Plano</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Nenhum pedido ainda.
                </TableCell>
              </TableRow>
            )}
            {orders.map((o) => {
              const st = statusMap[o.status] ?? statusMap.pending;
              const product = o.plans?.name ?? o.contents?.title ?? "—";
              const client =
                o.users?.name ??
                (o.users?.telegram_username
                  ? `@${o.users.telegram_username}`
                  : o.users?.telegram_id);
              return (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{client}</TableCell>
                  <TableCell>{product}</TableCell>
                  <TableCell>{brl(o.amount)}</TableCell>
                  <TableCell>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDate(o.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {o.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => pay.mutate(o.id)}
                        disabled={pay.isPending}
                      >
                        <Check className="mr-1 h-4 w-4 text-primary" /> Verificar pagamento
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remover transacao da lista"
                      disabled={hide.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Remover esta transação da lista? O registro fica preservado no banco, mas não aparece mais aqui.",
                          )
                        ) {
                          hide.mutate(o.id);
                        }
                      }}
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
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
