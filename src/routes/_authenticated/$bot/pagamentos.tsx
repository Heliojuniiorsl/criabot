import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Clock3, CreditCard, Search, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listImageBotPayments } from "@/lib/api/admin.functions";

export const Route = createFileRoute("/_authenticated/$bot/pagamentos")({
  component: ImageBotPayments,
});

type PaymentStatus = "pending" | "paid" | "canceled" | "expired";
type PaymentRow = {
  id: string;
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  product_type: "category_access" | "limit_upgrade" | "premium_plan";
  plan_name: string | null;
  category: "hetero" | "trans" | null;
  amount: number;
  status: PaymentStatus;
  provider: string;
  provider_payment_id: string | null;
  raw_status: string | null;
  paid_at: string | null;
  pix_expires_at: string | null;
  benefit_expires_at: string | null;
  bonus_count: number | null;
  access_type: "days" | "lifetime" | null;
  access_days: number | null;
  created_at: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "-";

const statusDetails: Record<
  PaymentStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pendente", variant: "outline" },
  paid: { label: "Pago", variant: "default" },
  canceled: { label: "Cancelado", variant: "destructive" },
  expired: { label: "Expirado", variant: "secondary" },
};

function ImageBotPayments() {
  const listFn = useServerFn(listImageBotPayments);
  const { data: payments } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-payments"],
      queryFn: () => listFn() as Promise<PaymentRow[]>,
      refetchInterval: 15_000,
    }),
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | PaymentStatus>("all");
  const [product, setProduct] = useState<"all" | PaymentRow["product_type"]>("all");

  const visiblePayments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return payments.filter((payment) => {
      const name = [payment.first_name, payment.last_name].filter(Boolean).join(" ");
      const content =
        `${name} ${payment.username ?? ""} ${payment.telegram_user_id} ${payment.provider_payment_id ?? ""} ${payment.id}`.toLowerCase();
      return (
        (!term || content.includes(term)) &&
        (status === "all" || payment.status === status) &&
        (product === "all" || payment.product_type === product)
      );
    });
  }, [payments, product, search, status]);

  const approved = payments.filter((payment) => payment.status === "paid");
  const pending = payments.filter((payment) => payment.status === "pending").length;
  const revenue = approved.reduce((sum, payment) => sum + Number(payment.amount), 0);

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Pagamentos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Histórico completo das transações do UpMídias.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Transações" value={String(payments.length)} icon={CreditCard} />
        <SummaryCard label="Aprovadas" value={String(approved.length)} icon={CheckCircle2} />
        <SummaryCard label="Pendentes" value={String(pending)} icon={Clock3} />
        <SummaryCard label="Receita aprovada" value={formatCurrency(revenue)} icon={TrendingUp} />
      </div>

      <Card className="mt-6 gap-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_190px_210px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar usuário, Telegram ID, pedido ou pagamento..."
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="paid">Pagos</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="expired">Expirados</SelectItem>
              <SelectItem value="canceled">Cancelados</SelectItem>
            </SelectContent>
          </Select>
          <Select value={product} onValueChange={(value) => setProduct(value as typeof product)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os produtos</SelectItem>
              <SelectItem value="category_access">Acesso por categoria</SelectItem>
              <SelectItem value="limit_upgrade">Mais limite</SelectItem>
              <SelectItem value="premium_plan">Plano Premium</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead>Pago em</TableHead>
                <TableHead>Validade do benefício</TableHead>
                <TableHead>ID Mercado Pago</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!visiblePayments.length && (
                <TableRow>
                  <TableCell colSpan={8} className="py-14 text-center text-muted-foreground">
                    Nenhuma transacao encontrada.
                  </TableCell>
                </TableRow>
              )}
              {visiblePayments.map((payment) => {
                const statusInfo = statusDetails[payment.status];
                const name =
                  [payment.first_name, payment.last_name].filter(Boolean).join(" ") ||
                  (payment.username ? `@${payment.username}` : String(payment.telegram_user_id));
                return (
                  <TableRow key={`${payment.product_type}:${payment.id}`}>
                    <TableCell>
                      <div className="font-medium">{name}</div>
                      <div className="text-xs text-muted-foreground">
                        {payment.username ? `@${payment.username} - ` : ""}
                        {payment.telegram_user_id}
                      </div>
                    </TableCell>
                    <TableCell>{productLabel(payment)}</TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(Number(payment.amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                      {payment.raw_status && payment.raw_status !== payment.status && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {payment.raw_status}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(payment.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(payment.paid_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {benefitValidity(payment)}
                    </TableCell>
                    <TableCell className="max-w-52">
                      <code
                        className="block truncate text-xs text-muted-foreground"
                        title={payment.provider_payment_id ?? payment.id}
                      >
                        {payment.provider_payment_id ?? payment.id}
                      </code>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          {visiblePayments.length} de {payments.length} transacao(oes).
        </p>
      </Card>
    </div>
  );
}

function productLabel(payment: PaymentRow) {
  if (payment.product_type === "premium_plan") {
    return payment.plan_name || "Plano Premium";
  }
  if (payment.product_type === "limit_upgrade") {
    return `+${payment.bonus_count ?? 0} mídias por dia`;
  }
  return `Acesso ${payment.category === "hetero" ? "Hetero" : "Trans"}`;
}

function benefitValidity(payment: PaymentRow) {
  if (payment.status !== "paid") return "-";
  if (payment.product_type === "limit_upgrade" && payment.access_type === "lifetime") {
    return "Vitalício";
  }
  if (payment.product_type === "premium_plan" && payment.access_type === "lifetime") {
    return "Vitalício";
  }
  return formatDate(payment.benefit_expires_at);
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof CreditCard;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-4 font-display text-2xl font-semibold">{value}</div>
    </Card>
  );
}
