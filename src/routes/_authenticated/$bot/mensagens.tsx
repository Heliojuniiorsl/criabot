import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listBroadcasts,
  saveBroadcast,
  deleteBroadcast,
  sendBroadcastNow,
  listPlans,
  listOffers,
} from "@/lib/api/admin.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Trash2, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { ImageUpload } from "@/components/ImageUpload";

export const Route = createFileRoute("/_authenticated/$bot/mensagens")({
  component: Mensagens,
});

type BtnKind = "link" | "plans" | "plan" | "offers" | "menu";
type Btn = { label: string; kind: BtnKind; url?: string | null; plan_id?: string | null };
type Broadcast = {
  id: string;
  title: string;
  message: string;
  image_url: string | null;
  content_kind?: "custom" | "telegram_message";
  source_chat_id?: number | string | null;
  source_message_id?: number | null;
  buttons: Btn[];
  interval_minutes: number;
  is_active: boolean;
  last_sent_at: string | null;
  audience_type: "all" | "plan" | "purchase" | "active" | "inactive";
  audience_value: string | null;
  activity_days: number;
};

const kindLabel: Record<BtnKind, string> = {
  link: "Link externo",
  plans: "Abrir planos",
  plan: "Abrir um plano",
  offers: "Abrir ofertas",
  menu: "Abrir menu",
};

function Mensagens() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBroadcasts);
  const saveFn = useServerFn(saveBroadcast);
  const delFn = useServerFn(deleteBroadcast);
  const sendFn = useServerFn(sendBroadcastNow);
  const plansFn = useServerFn(listPlans);
  const offersFn = useServerFn(listOffers);

  const { data: items } = useSuspenseQuery(
    queryOptions({ queryKey: ["broadcasts"], queryFn: () => listFn() as Promise<Broadcast[]> }),
  );
  const { data: plans } = useSuspenseQuery(
    queryOptions({ queryKey: ["plans"], queryFn: () => plansFn() as Promise<any[]> }),
  );
  const { data: offers } = useSuspenseQuery(
    queryOptions({ queryKey: ["offers"], queryFn: () => offersFn() as Promise<any[]> }),
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [contentKind, setContentKind] = useState<"custom" | "telegram_message">("custom");
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [audienceType, setAudienceType] = useState<Broadcast["audience_type"]>("all");
  const [audienceValue, setAudienceValue] = useState("");

  const save = useMutation({
    mutationFn: (p: any) => saveFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      setOpen(false);
      toast.success("Mensagem salva");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      toast.success("Mensagem excluída");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const sendNow = useMutation({
    mutationFn: (id: string) => sendFn({ data: { id } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["broadcasts"] });
      toast.success(`Enviada para ${r.sent} usuário(s)`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setImageUrl("");
    setContentKind("custom");
    setButtons([]);
    setAudienceType("all");
    setAudienceValue("");
    setOpen(true);
  }
  function openEdit(b: Broadcast) {
    setEditing(b);
    setImageUrl(b.image_url ?? "");
    setContentKind(b.content_kind ?? "custom");
    setButtons(b.buttons ?? []);
    setAudienceType(b.audience_type ?? "all");
    setAudienceValue(b.audience_value ?? "");
    setOpen(true);
  }

  function addButton() {
    setButtons((prev) => [...prev, { label: "", kind: "plans", url: "" }]);
  }
  function updateButton(i: number, patch: Partial<Btn>) {
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function removeButton(i: number) {
    setButtons((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cleanButtons = buttons
      .filter((b) => b.label.trim())
      .map((b) => ({
        label: b.label.trim(),
        kind: b.kind,
        url: b.kind === "link" ? (b.url ?? "") : null,
        plan_id: b.kind === "plan" ? b.plan_id : null,
      }));
    save.mutate({
      id: editing?.id,
      title: String(f.get("title")),
      message: String(f.get("message") || ""),
      image_url: contentKind === "custom" ? imageUrl || null : null,
      content_kind: contentKind,
      source_chat_id:
        contentKind === "telegram_message" ? String(f.get("source_chat_id") || "").trim() : null,
      source_message_id:
        contentKind === "telegram_message" ? Number(f.get("source_message_id")) : null,
      buttons: cleanButtons,
      interval_minutes: Number(f.get("interval_minutes")),
      audience_type: audienceType,
      audience_value: audienceType === "purchase" ? audienceValue || "any:" : audienceValue || null,
      activity_days: Number(f.get("activity_days") || 30),
      is_active: f.get("is_active") === "on",
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Mensagens automáticas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Disparos periódicos para todos os usuários do bot — promoções, descontos e novos planos.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> Nova mensagem
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar mensagem" : "Nova mensagem"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título (interno)</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  defaultValue={editing?.title}
                  placeholder="Ex: Promoção de fim de semana"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="content_kind">Conteúdo da mensagem</Label>
                <select
                  id="content_kind"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={contentKind}
                  onChange={(event) =>
                    setContentKind(event.target.value as "custom" | "telegram_message")
                  }
                >
                  <option value="custom">Criar texto, foto ou vídeo aqui</option>
                  <option value="telegram_message">Usar mensagem pronta pelo ID</option>
                </select>
              </div>
              {contentKind === "custom" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="message">Descrição / texto da mensagem</Label>
                    <Textarea
                      id="message"
                      name="message"
                      rows={4}
                      defaultValue={editing?.message ?? ""}
                      placeholder="Texto que o usuário vai receber..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Foto ou vídeo da mensagem</Label>
                    <ImageUpload
                      value={imageUrl}
                      onChange={setImageUrl}
                      accept="image/*,video/mp4,video/quicktime,video/webm"
                      allowedKinds={["image", "video"]}
                      buttonLabel="Enviar foto ou vídeo"
                      maxSizeMb={60}
                    />
                  </div>
                </>
              ) : (
                <Card className="grid gap-4 border-dashed p-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="source_chat_id">ID do chat de origem</Label>
                    <Input
                      id="source_chat_id"
                      name="source_chat_id"
                      required
                      defaultValue={editing?.source_chat_id ?? ""}
                      placeholder="-1001234567890 ou @canal"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source_message_id">ID da mensagem</Label>
                    <Input
                      id="source_message_id"
                      name="source_message_id"
                      type="number"
                      min="1"
                      required
                      defaultValue={editing?.source_message_id ?? ""}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    O bot precisa ter acesso ao chat de origem. Os botões configurados abaixo serão
                    adicionados à mensagem copiada.
                  </p>
                </Card>
              )}
              <div className="space-y-2">
                <Label htmlFor="interval_minutes">Enviar a cada (minutos)</Label>
                <Input
                  id="interval_minutes"
                  name="interval_minutes"
                  type="number"
                  min="1"
                  max="525600"
                  required
                  defaultValue={editing?.interval_minutes ?? 60}
                />
              </div>

              <Card className="space-y-4 border-dashed p-4">
                <div>
                  <Label>Segmentação</Label>
                  <p className="text-xs text-muted-foreground">
                    Escolha exatamente quem receberá esta mensagem.
                  </p>
                </div>
                <Select
                  value={audienceType}
                  onValueChange={(value) => {
                    setAudienceType(value as Broadcast["audience_type"]);
                    setAudienceValue("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os clientes</SelectItem>
                    <SelectItem value="plan">Assinantes de um plano</SelectItem>
                    <SelectItem value="purchase">Quem realizou uma compra</SelectItem>
                    <SelectItem value="active">Ativos recentemente</SelectItem>
                    <SelectItem value="inactive">Inativos há alguns dias</SelectItem>
                  </SelectContent>
                </Select>
                {audienceType === "plan" && (
                  <Select value={audienceValue} onValueChange={setAudienceValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o plano" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {audienceType === "purchase" && (
                  <Select value={audienceValue || "any:"} onValueChange={setAudienceValue}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any:">Qualquer compra paga</SelectItem>
                      {plans.map((plan) => (
                        <SelectItem key={`plan:${plan.id}`} value={`plan:${plan.id}`}>
                          Plano: {plan.name}
                        </SelectItem>
                      ))}
                      {offers.map((offer) => (
                        <SelectItem key={`offer:${offer.id}`} value={`offer:${offer.id}`}>
                          Oferta: {offer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(audienceType === "active" || audienceType === "inactive") && (
                  <div className="space-y-2">
                    <Label htmlFor="activity_days">Período de atividade (dias)</Label>
                    <Input
                      id="activity_days"
                      name="activity_days"
                      type="number"
                      min="1"
                      max="3650"
                      defaultValue={editing?.activity_days ?? 30}
                    />
                  </div>
                )}
                {audienceType !== "active" && audienceType !== "inactive" && (
                  <input type="hidden" name="activity_days" value={editing?.activity_days ?? 30} />
                )}
              </Card>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Botões</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addButton}>
                    <Plus className="mr-1 h-3 w-3" /> Botão
                  </Button>
                </div>
                {buttons.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum botão. A mensagem será enviada apenas com texto/foto.
                  </p>
                )}
                <div className="space-y-3">
                  {buttons.map((b, i) => (
                    <div key={i} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={b.label}
                          onChange={(e) => updateButton(i, { label: e.target.value })}
                          placeholder="Texto do botão (ex: 💎 Ver planos)"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeButton(i)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <Select
                        value={b.kind}
                        onValueChange={(v) =>
                          updateButton(i, {
                            kind: v as BtnKind,
                            url: v === "link" ? b.url : null,
                            plan_id: v === "plan" ? b.plan_id : null,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="plans">Abrir planos</SelectItem>
                          <SelectItem value="plan">Abrir um plano específico</SelectItem>
                          <SelectItem value="offers">Abrir ofertas</SelectItem>
                          <SelectItem value="menu">Abrir menu</SelectItem>
                          <SelectItem value="link">Link externo</SelectItem>
                        </SelectContent>
                      </Select>
                      {b.kind === "link" && (
                        <Input
                          value={b.url ?? ""}
                          onChange={(e) => updateButton(i, { url: e.target.value })}
                          placeholder="https://..."
                        />
                      )}
                      {b.kind === "plan" && (
                        <Select
                          value={b.plan_id ?? ""}
                          onValueChange={(planId) => {
                            const plan = plans.find((item) => item.id === planId);
                            updateButton(i, {
                              plan_id: planId,
                              label: b.label.trim() || plan?.name || "Ver plano",
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Escolha o plano" />
                          </SelectTrigger>
                          <SelectContent>
                            {plans
                              .filter((plan) => plan.is_active)
                              .map((plan) => (
                                <SelectItem key={plan.id} value={plan.id}>
                                  {plan.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  name="is_active"
                  defaultChecked={editing ? editing.is_active : true}
                />
                <Label htmlFor="is_active">Ativa</Label>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="mt-8 p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              <TableHead>Intervalo</TableHead>
              <TableHead>Botões</TableHead>
              <TableHead>Público</TableHead>
              <TableHead>Último envio</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Nenhuma mensagem automática.
                </TableCell>
              </TableRow>
            )}
            {items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.title}</TableCell>
                <TableCell>{b.interval_minutes} min</TableCell>
                <TableCell>{b.buttons?.length ?? 0}</TableCell>
                <TableCell className="capitalize">
                  {b.audience_type === "all" ? "Todos" : b.audience_type}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {b.last_sent_at ? new Date(b.last_sent_at).toLocaleString("pt-BR") : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={b.is_active ? "default" : "secondary"}>
                    {b.is_active ? "Ativa" : "Inativa"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Enviar agora"
                    disabled={sendNow.isPending}
                    onClick={() => {
                      if (confirm("Enviar agora para todos os usuários?")) sendNow.mutate(b.id);
                    }}
                  >
                    <Send className="h-4 w-4 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(b)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm("Excluir mensagem?")) remove.mutate(b.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
