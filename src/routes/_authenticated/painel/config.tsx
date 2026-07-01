import { createFileRoute } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/painel/config")({
  component: ConfigPage,
});

function ConfigPage() {
  const [platformName, setPlatformName] = useState("CriaBot");
  const [pixKey, setPixKey] = useState("");
  const [webhook, setWebhook] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    toast.success("Configurações salvas localmente nesta tela.");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Configuração</h1>
        <p className="mt-2 text-muted-foreground">
          Ajustes gerais da plataforma. Por enquanto estes campos sao a base visual da tela.
        </p>
      </div>

      <Card className="border bg-card p-5 shadow-sm sm:p-6">
        <form className="max-w-2xl space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="platform_name">Nome da plataforma</Label>
            <Input
              id="platform_name"
              value={platformName}
              onChange={(event) => setPlatformName(event.target.value)}
              placeholder="CriaBot"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pix_key">Chave Pix / pagamento</Label>
            <Input
              id="pix_key"
              value={pixKey}
              onChange={(event) => setPixKey(event.target.value)}
              placeholder="Digite a chave Pix principal"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook">Webhook</Label>
            <Input
              id="webhook"
              value={webhook}
              onChange={(event) => setWebhook(event.target.value)}
              placeholder="https://criabot.squareweb.app/api/public/payments/webhook"
            />
          </div>

          <Button type="submit">
            <Save className="mr-2 h-4 w-4" />
            Salvar
          </Button>
        </form>
      </Card>
    </div>
  );
}
