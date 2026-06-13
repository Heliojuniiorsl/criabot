import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pagamento")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: typeof search.status === "string" ? search.status : undefined,
  }),
  component: PaymentReturn,
});

function PaymentReturn() {
  const { status } = Route.useSearch();
  const message =
    status === "success"
      ? "Pagamento recebido. A confirmação e a entrega serão enviadas pelo Telegram."
      : status === "pending"
        ? "Pagamento pendente. Você receberá uma mensagem no Telegram após a aprovação."
        : "O pagamento não foi concluído. Volte ao Telegram para tentar novamente.";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="font-display text-2xl font-semibold">Mercado Pago</h1>
        <p className="mt-4 text-muted-foreground">{message}</p>
      </div>
    </main>
  );
}
