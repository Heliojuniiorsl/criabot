import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getSettings, saveSettings } from "@/lib/api/admin.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck } from "lucide-react";
import { ImageUpload } from "@/components/ImageUpload";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: Configuracoes,
});

type MenuButton = { id: string; label: string; enabled: boolean };

const DEFAULT_BUTTONS: MenuButton[] = [
  { id: "plans", label: "💎 Ver planos", enabled: true },
  { id: "contents", label: "🖼️ Comprar conteúdo", enabled: true },
  { id: "myaccess", label: "🔑 Meus acessos", enabled: true },
  { id: "support", label: "💬 Suporte", enabled: true },
  { id: "terms", label: "📜 Termos e regras", enabled: true },
];

function Configuracoes() {
  const qc = useQueryClient();
  const getFn = useServerFn(getSettings);
  const saveFn = useServerFn(saveSettings);

  const { data: settings } = useSuspenseQuery(
    queryOptions({ queryKey: ["settings"], queryFn: () => getFn() as Promise<any> }),
  );

  const [imageUrl, setImageUrl] = useState<string>(settings.welcome_image_url ?? "");
  const [buttons, setButtons] = useState<MenuButton[]>(() => {
    const fromDb = Array.isArray(settings.menu_buttons) ? settings.menu_buttons : null;
    return fromDb && fromDb.length ? fromDb : DEFAULT_BUTTONS;
  });

  const save = useMutation({
    mutationFn: (p: any) => saveFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Configurações salvas");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function updateButton(id: string, patch: Partial<MenuButton>) {
    setButtons((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      id: settings.id,
      welcome_message: String(f.get("welcome_message")),
      welcome_image_url: imageUrl || null,
      terms_text: String(f.get("terms_text")),
      support_link: String(f.get("support_link") || ""),
      private_group_link: String(f.get("private_group_link") || ""),
      payment_info: String(f.get("payment_info") || ""),
      menu_buttons: buttons,
    });
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Configurações do bot</h1>
      <p className="mt-1 text-sm text-muted-foreground">Imagem, mensagens, botões e acessos.</p>

      <Card className="mt-6 flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Token do bot:</span> está armazenado com
          segurança no servidor (nunca exposto no navegador). Para trocar o token, peça ao
          assistente para atualizá-lo.
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        {/* Boas-vindas + imagem */}
        <Card className="space-y-4 p-6">
          <h2 className="font-display text-lg font-semibold">Boas-vindas</h2>
          <div className="space-y-2">
            <Label htmlFor="welcome_message">Mensagem inicial do bot</Label>
            <Textarea
              id="welcome_message"
              name="welcome_message"
              rows={3}
              defaultValue={settings.welcome_message}
            />
          </div>
          <div className="space-y-2">
            <Label>Imagem de boas-vindas</Label>
            <p className="text-xs text-muted-foreground">
              Envie uma imagem (jpg/png) ou cole um link. Ela aparece junto da mensagem inicial no
              /start.
            </p>
            <ImageUpload value={imageUrl} onChange={setImageUrl} />
          </div>
        </Card>

        {/* Botões do menu */}
        <Card className="space-y-4 p-6">
          <h2 className="font-display text-lg font-semibold">Botões do menu</h2>
          <p className="text-sm text-muted-foreground">
            Edite o texto de cada botão e ative/desative os que quiser exibir no bot.
          </p>
          <div className="space-y-3">
            {buttons.map((b) => (
              <div key={b.id} className="flex items-center gap-3">
                <Input
                  value={b.label}
                  maxLength={64}
                  onChange={(e) => updateButton(b.id, { label: e.target.value })}
                  className="flex-1"
                />
                <div className="flex items-center gap-2">
                  <Switch
                    checked={b.enabled}
                    onCheckedChange={(v) => updateButton(b.id, { enabled: v })}
                  />
                  <span className="w-16 text-xs text-muted-foreground">
                    {b.enabled ? "Ativo" : "Oculto"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Acessos e textos */}
        <Card className="space-y-4 p-6">
          <h2 className="font-display text-lg font-semibold">Acessos e textos</h2>
          <div className="space-y-2">
            <Label htmlFor="private_group_link">
              Link do grupo privado (liberado após pagamento)
            </Label>
            <Input
              id="private_group_link"
              name="private_group_link"
              placeholder="https://t.me/+..."
              defaultValue={settings.private_group_link ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="support_link">Link de suporte</Label>
            <Input
              id="support_link"
              name="support_link"
              placeholder="https://t.me/seuusuario"
              defaultValue={settings.support_link ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payment_info">Instruções/dados de pagamento</Label>
            <Textarea
              id="payment_info"
              name="payment_info"
              rows={3}
              placeholder="PIX, instruções, etc."
              defaultValue={settings.payment_info ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="terms_text">Texto dos termos e regras</Label>
            <Textarea
              id="terms_text"
              name="terms_text"
              rows={5}
              defaultValue={settings.terms_text}
            />
          </div>
        </Card>

        <Button type="submit" disabled={save.isPending}>
          Salvar configurações
        </Button>
      </form>
    </div>
  );
}
