import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  deleteImageBotPremiumPlanAdmin,
  deletePlan,
  getImageBotSettings,
  listImageBotPremiumPlans,
  listPlans,
  saveImageBotFreePlanSettings,
  saveImageBotPremiumPlanAdmin,
  saveImageBotPremiumReminderSettings,
  savePlan,
} from "@/lib/api/admin.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useManagedBotPanel } from "@/lib/managed-bot-context";

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export const Route = createFileRoute("/_authenticated/$bot/planos")({
  component: PlansRoute,
});

type Plan = {
  id: string;
  name: string;
  description: string | null;
  button_label: string | null;
  detail_message: string | null;
  description_mode: "custom" | "telegram_message";
  description_source_chat_id: number | string | null;
  description_source_message_id: number | null;
  access_chat_id: number | string | null;
  access_type: "days" | "lifetime";
  price: number;
  duration_days: number;
  promo_price: number | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  renewal_enabled: boolean;
  is_active: boolean;
};

const inputDate = (value?: string | null) =>
  value ? new Date(value).toISOString().slice(0, 16) : "";

function PlansRoute() {
  const bot = useManagedBotPanel();
  return bot.kind === "images" ? <ImageBotPremiumPlans /> : <SalesPlans />;
}

function SalesPlans() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPlans);
  const saveFn = useServerFn(savePlan);
  const delFn = useServerFn(deletePlan);

  const { data: plans } = useSuspenseQuery(
    queryOptions({ queryKey: ["plans"], queryFn: () => listFn() as Promise<Plan[]> }),
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [descriptionMode, setDescriptionMode] = useState<"custom" | "telegram_message">("custom");
  const [accessType, setAccessType] = useState<"days" | "lifetime">("days");

  const save = useMutation({
    mutationFn: (p: any) => saveFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      setOpen(false);
      toast.success("Plano salvo");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("Plano excluído");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setDescriptionMode("custom");
    setAccessType("days");
    setOpen(true);
  }
  function openEdit(p: Plan) {
    setEditing(p);
    setDescriptionMode(p.description_mode ?? "custom");
    setAccessType(p.access_type ?? "days");
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      id: editing?.id,
      name: String(f.get("name")),
      button_label: String(f.get("button_label") || ""),
      description: String(f.get("description") || ""),
      detail_message: String(f.get("detail_message") || ""),
      description_mode: descriptionMode,
      description_source_chat_id:
        descriptionMode === "telegram_message"
          ? String(f.get("description_source_chat_id") || "").trim()
          : null,
      description_source_message_id:
        descriptionMode === "telegram_message"
          ? Number(f.get("description_source_message_id"))
          : null,
      access_chat_id: String(f.get("access_chat_id") || "").trim(),
      access_type: accessType,
      price: Number(f.get("price")),
      duration_days: accessType === "lifetime" ? 1 : Number(f.get("duration_days")),
      promo_price: f.get("promo_price") ? Number(f.get("promo_price")) : null,
      promo_starts_at: f.get("promo_starts_at")
        ? new Date(String(f.get("promo_starts_at"))).toISOString()
        : null,
      promo_ends_at: f.get("promo_ends_at")
        ? new Date(String(f.get("promo_ends_at"))).toISOString()
        : null,
      renewal_enabled: accessType === "days" && f.get("renewal_enabled") === "on",
      is_active: f.get("is_active") === "on",
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Planos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Mensal, semanal e pacotes.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> Novo plano
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar plano" : "Novo plano"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" name="name" required defaultValue={editing?.name} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="button_label">Texto do botão na lista</Label>
                <Input
                  id="button_label"
                  name="button_label"
                  maxLength={80}
                  defaultValue={editing?.button_label ?? ""}
                  placeholder="Ex: 🔥 VIP completo — {{preco}}"
                />
                <p className="text-xs text-muted-foreground">
                  Se ficar vazio, o bot usa nome e preço. Variáveis: {"{{nome}}"}, {"{{preco}}"} e{" "}
                  {"{{validade}}"}.
                </p>
              </div>
              <Card className="space-y-4 border-dashed p-4">
                <div className="space-y-2">
                  <Label htmlFor="description_mode">Descrição exibida no Telegram</Label>
                  <select
                    id="description_mode"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={descriptionMode}
                    onChange={(event) =>
                      setDescriptionMode(event.target.value as "custom" | "telegram_message")
                    }
                  >
                    <option value="custom">Escrever a descrição aqui</option>
                    <option value="telegram_message">Usar mensagem pronta pelo ID</option>
                  </select>
                </div>
                {descriptionMode === "custom" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="description">Descrição</Label>
                      <Textarea
                        id="description"
                        name="description"
                        rows={5}
                        defaultValue={editing?.description ?? ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="detail_message">Mensagem completa ao abrir o plano</Label>
                      <Textarea
                        id="detail_message"
                        name="detail_message"
                        rows={7}
                        defaultValue={editing?.detail_message ?? ""}
                        placeholder={"💎 {{nome}}\n{{descricao}}\n\n⏳ {{validade}}\n💰 {{preco}}"}
                      />
                      <p className="text-xs text-muted-foreground">
                        Se ficar vazio, o bot monta automaticamente. Variáveis: {"{{nome}}"},{" "}
                        {"{{descricao}}"}, {"{{preco}}"}, {"{{validade}}"} e {"{{preco_original}}"}.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="description_source_chat_id">ID do chat de origem</Label>
                      <Input
                        id="description_source_chat_id"
                        name="description_source_chat_id"
                        required
                        defaultValue={editing?.description_source_chat_id ?? ""}
                        placeholder="-1001234567890 ou @canal"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description_source_message_id">ID da mensagem</Label>
                      <Input
                        id="description_source_message_id"
                        name="description_source_message_id"
                        type="number"
                        min="1"
                        required
                        defaultValue={editing?.description_source_message_id ?? ""}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      O bot precisa ter acesso ao chat de origem. A mensagem será copiada com os
                      botões de comprar e voltar aos planos.
                    </p>
                  </div>
                )}
              </Card>
              <Card className="space-y-2 border-dashed p-4">
                <Label htmlFor="access_chat_id">ID do grupo VIP entregue após o pagamento</Label>
                <Input
                  id="access_chat_id"
                  name="access_chat_id"
                  required
                  defaultValue={editing?.access_chat_id ?? ""}
                  placeholder="-1001234567890"
                />
                <p className="text-xs text-muted-foreground">
                  O bot deve ser administrador do grupo. O comprador receberá um convite individual
                  que expira em 24 horas.
                </p>
              </Card>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="price">Preço (R$)</Label>
                  <Input
                    id="price"
                    name="price"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    defaultValue={editing?.price}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="access_type">Validade</Label>
                  <select
                    id="access_type"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={accessType}
                    onChange={(event) => setAccessType(event.target.value as "days" | "lifetime")}
                  >
                    <option value="days">Por dias</option>
                    <option value="lifetime">Vitalicio</option>
                  </select>
                </div>
                {accessType === "days" ? (
                  <div className="space-y-2">
                    <Label htmlFor="duration_days">Duração (dias)</Label>
                    <Input
                      id="duration_days"
                      name="duration_days"
                      type="number"
                      min="1"
                      required
                      defaultValue={editing?.duration_days ?? 30}
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
                    Este plano nunca vence e nao envia avisos de renovacao.
                  </div>
                )}
              </div>
              <Card className="space-y-3 border-dashed p-4">
                <div>
                  <Label>Promoção com prazo</Label>
                  <p className="text-xs text-muted-foreground">
                    Opcional. O bot usa esse preço somente durante o período.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="promo_price">Preço promocional</Label>
                    <Input
                      id="promo_price"
                      name="promo_price"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={editing?.promo_price ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="promo_starts_at">Início</Label>
                    <Input
                      id="promo_starts_at"
                      name="promo_starts_at"
                      type="datetime-local"
                      defaultValue={inputDate(editing?.promo_starts_at)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="promo_ends_at">Fim</Label>
                    <Input
                      id="promo_ends_at"
                      name="promo_ends_at"
                      type="datetime-local"
                      defaultValue={inputDate(editing?.promo_ends_at)}
                    />
                  </div>
                </div>
              </Card>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  name="is_active"
                  defaultChecked={editing ? editing.is_active : true}
                />
                <Label htmlFor="is_active">Ativo</Label>
              </div>
              {accessType === "days" && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="renewal_enabled"
                    name="renewal_enabled"
                    defaultChecked={editing ? editing.renewal_enabled : true}
                  />
                  <Label htmlFor="renewal_enabled">Permitir renovação e avisos</Label>
                </div>
              )}
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
              <TableHead>Nome</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Duração</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nenhum plano cadastrado.
                </TableCell>
              </TableRow>
            )}
            {plans.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  {p.promo_price !== null ? (
                    <>
                      <span className="text-xs text-muted-foreground line-through">
                        {brl(p.price)}
                      </span>
                      <br />
                      {brl(p.promo_price)}
                    </>
                  ) : (
                    brl(p.price)
                  )}
                </TableCell>
                <TableCell>
                  {p.access_type === "lifetime" ? "Vitalicio" : `${p.duration_days} dias`}
                </TableCell>
                <TableCell>
                  <Badge variant={p.is_active ? "default" : "secondary"}>
                    {p.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm("Excluir plano?")) remove.mutate(p.id);
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

type ImageBotPremiumPlan = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  access_type: "days" | "lifetime";
  access_days: number;
  allow_favorites: boolean;
  media_cooldown_seconds: number;
  daily_media_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ImageBotFreePlanSettings = {
  id: string;
  daily_limit_message: string;
  flood_cooldown_seconds: number;
  daily_media_limit: number;
  premium_expiry_warning_days: number;
  premium_expiry_warning_message: string;
  premium_expiry_repeat_count: number;
  premium_expiry_repeat_interval_minutes: number;
  premium_offer_button_label: string;
};

function ImageBotPremiumPlans() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listImageBotPremiumPlans);
  const getSettingsFn = useServerFn(getImageBotSettings);
  const saveFn = useServerFn(saveImageBotPremiumPlanAdmin);
  const deleteFn = useServerFn(deleteImageBotPremiumPlanAdmin);
  const { data: plans } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-premium-plans"],
      queryFn: () => listFn() as Promise<ImageBotPremiumPlan[]>,
    }),
  );
  const { data: freePlanSettings } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-settings"],
      queryFn: () => getSettingsFn() as Promise<ImageBotFreePlanSettings>,
    }),
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ImageBotPremiumPlan | null>(null);
  const [accessType, setAccessType] = useState<"days" | "lifetime">("days");

  const save = useMutation({
    mutationFn: (data: {
      id?: string;
      name: string;
      description: string | null;
      price: number;
      access_type: "days" | "lifetime";
      access_days: number;
      allow_favorites: boolean;
      media_cooldown_seconds: number;
      daily_media_limit: number;
      is_active: boolean;
    }) => saveFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-bot-premium-plans"] });
      setOpen(false);
      setEditing(null);
      toast.success("Plano Premium salvo");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-bot-premium-plans"] });
      toast.success("Plano Premium excluido");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function openNewPlan() {
    setEditing(null);
    setAccessType("days");
    setOpen(true);
  }

  function openPlan(plan: ImageBotPremiumPlan) {
    setEditing(plan);
    setAccessType(plan.access_type);
    setOpen(true);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      id: editing?.id,
      name: String(form.get("name") || "").trim(),
      description: String(form.get("description") || "").trim() || null,
      price: Number(form.get("price")),
      access_type: accessType,
      access_days: accessType === "lifetime" ? 1 : Number(form.get("access_days")),
      allow_favorites: form.get("allow_favorites") === "on",
      media_cooldown_seconds: Number(form.get("media_cooldown_seconds")),
      daily_media_limit: Number(form.get("daily_media_limit")),
      is_active: form.get("is_active") === "on",
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Planos Premium</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie quantos planos quiser. Eles aparecem no bot quando um usuario gratuito tenta
            favoritar.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewPlan}>
              <Plus className="mr-2 h-4 w-4" /> Novo plano
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar plano Premium" : "Novo plano Premium"}</DialogTitle>
            </DialogHeader>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="premium_name">Nome</Label>
                <Input
                  id="premium_name"
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={editing?.name ?? ""}
                  placeholder="Ex: Premium 30 dias"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="premium_description">Descricao</Label>
                <Textarea
                  id="premium_description"
                  name="description"
                  maxLength={500}
                  defaultValue={editing?.description ?? ""}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="premium_price">Preco (R$)</Label>
                  <Input
                    id="premium_price"
                    name="price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={editing?.price ?? 5}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="premium_access_type">Validade</Label>
                  <select
                    id="premium_access_type"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={accessType}
                    onChange={(event) => setAccessType(event.target.value as "days" | "lifetime")}
                  >
                    <option value="days">Por dias</option>
                    <option value="lifetime">Vitalicio</option>
                  </select>
                </div>
              </div>
              {accessType === "days" && (
                <div className="space-y-2">
                  <Label htmlFor="premium_access_days">Quantidade de dias</Label>
                  <Input
                    id="premium_access_days"
                    name="access_days"
                    type="number"
                    min="1"
                    max="36500"
                    required
                    defaultValue={editing?.access_days || 30}
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-2 rounded-2xl border p-3">
                  <Switch
                    id="premium_allow_favorites"
                    name="allow_favorites"
                    defaultChecked={editing?.allow_favorites ?? true}
                  />
                  <div>
                    <Label htmlFor="premium_allow_favorites">Libera favoritos</Label>
                    <p className="text-xs text-muted-foreground">
                      Se desligar, este plano nao da acesso ao menu Favoritos.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="premium_media_cooldown_seconds">
                    Delay entre midias (segundos)
                  </Label>
                  <Input
                    id="premium_media_cooldown_seconds"
                    name="media_cooldown_seconds"
                    type="number"
                    min="0"
                    max="60"
                    required
                    defaultValue={editing?.media_cooldown_seconds ?? 1}
                  />
                  <p className="text-xs text-muted-foreground">
                    0 envia sem espera; a protecao por minuto continua ativa.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="premium_daily_media_limit">Midias por dia</Label>
                <Input
                  id="premium_daily_media_limit"
                  name="daily_media_limit"
                  type="number"
                  min="0"
                  max="100000"
                  required
                  defaultValue={editing?.daily_media_limit ?? 0}
                />
                <p className="text-xs text-muted-foreground">
                  Use 0 para manter a quantidade definida no plano gratis.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="premium_is_active"
                  name="is_active"
                  defaultChecked={editing?.is_active ?? true}
                />
                <Label htmlFor="premium_is_active">Plano ativo no bot</Label>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={save.isPending}>
                  Salvar plano
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <FreePlanEditor settings={freePlanSettings} />
      <PremiumExpiryReminderEditor settings={freePlanSettings} />

      <Card className="mt-8 p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Recursos</TableHead>
              <TableHead>Preco</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <div className="font-medium">{plan.name}</div>
                  {plan.description && (
                    <div className="max-w-md truncate text-xs text-muted-foreground">
                      {plan.description}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={plan.allow_favorites ? "default" : "secondary"}>
                      {plan.allow_favorites ? "Favoritos" : "Sem favoritos"}
                    </Badge>
                    <Badge variant="outline">{plan.media_cooldown_seconds}s delay</Badge>
                    <Badge variant="outline">
                      {plan.daily_media_limit > 0
                        ? `${plan.daily_media_limit} midias/dia`
                        : "Cota do plano gratis"}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="font-medium">{brl(plan.price)}</TableCell>
                <TableCell>
                  {plan.access_type === "lifetime" ? "Vitalicio" : `${plan.access_days} dias`}
                </TableCell>
                <TableCell>
                  <Badge variant={plan.is_active ? "default" : "secondary"}>
                    {plan.is_active ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openPlan(plan)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Excluir o plano "${plan.name}"?`)) remove.mutate(plan.id);
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

function FreePlanEditor({ settings }: { settings: ImageBotFreePlanSettings }) {
  const queryClient = useQueryClient();
  const saveFn = useServerFn(saveImageBotFreePlanSettings);
  const save = useMutation({
    mutationFn: (data: {
      id: string;
      daily_limit_message: string;
      flood_cooldown_seconds: number;
      daily_media_limit: number;
    }) => saveFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-bot-settings"] });
      toast.success("Plano gratis atualizado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      id: settings.id,
      daily_limit_message: String(form.get("daily_limit_message") || "").trim(),
      flood_cooldown_seconds: Number(form.get("flood_cooldown_seconds")),
      daily_media_limit: Number(form.get("daily_media_limit")),
    });
  }

  return (
    <Card className="mt-8 p-6">
      <form className="space-y-5" onSubmit={submit}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-semibold">Plano gratis</h2>
              <Badge variant="secondary">Padrao</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Regras aplicadas a todos que ainda nao possuem Premium. Administradores continuam sem
              limite.
            </p>
          </div>
          <Button type="submit" disabled={save.isPending}>
            Salvar plano gratis
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="free_flood_cooldown_seconds">Intervalo entre pedidos (segundos)</Label>
            <Input
              id="free_flood_cooldown_seconds"
              name="flood_cooldown_seconds"
              type="number"
              min="0"
              max="60"
              defaultValue={settings.flood_cooldown_seconds}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="free_daily_media_limit">Midias por dia</Label>
            <Input
              id="free_daily_media_limit"
              name="daily_media_limit"
              type="number"
              min="0"
              max="10000"
              defaultValue={settings.daily_media_limit}
            />
            <p className="text-xs text-muted-foreground">Use 0 para ilimitado.</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="free_daily_limit_message">Mensagem completa ao atingir o limite</Label>
          <Textarea
            id="free_daily_limit_message"
            name="daily_limit_message"
            rows={5}
            defaultValue={settings.daily_limit_message}
          />
          <p className="text-xs text-muted-foreground">
            Todo este texto aparece exatamente acima dos botoes dos planos Premium.
          </p>
        </div>
      </form>
    </Card>
  );
}

function PremiumExpiryReminderEditor({ settings }: { settings: ImageBotFreePlanSettings }) {
  const queryClient = useQueryClient();
  const saveFn = useServerFn(saveImageBotPremiumReminderSettings);
  const save = useMutation({
    mutationFn: (data: {
      id: string;
      premium_expiry_warning_days: number;
      premium_expiry_warning_message: string;
      premium_expiry_repeat_count: number;
      premium_expiry_repeat_interval_minutes: number;
      premium_offer_button_label: string;
    }) => saveFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-bot-settings"] });
      toast.success("Aviso de vencimento atualizado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      id: settings.id,
      premium_expiry_warning_days: Number(form.get("premium_expiry_warning_days")),
      premium_expiry_warning_message: String(
        form.get("premium_expiry_warning_message") || "",
      ).trim(),
      premium_expiry_repeat_count: Number(form.get("premium_expiry_repeat_count")),
      premium_expiry_repeat_interval_minutes: Number(
        form.get("premium_expiry_repeat_interval_minutes"),
      ),
      premium_offer_button_label: String(form.get("premium_offer_button_label") || "").trim(),
    });
  }

  return (
    <Card className="mt-8 p-6">
      <form className="space-y-5" onSubmit={submit}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Aviso de vencimento Premium</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Defina quantas vezes o usuario sera avisado e o intervalo entre cada envio. Os planos
              ativos aparecem logo abaixo da mensagem.
            </p>
          </div>
          <Button type="submit" disabled={save.isPending}>
            Salvar aviso
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="premium_expiry_warning_days">Avisar quantos dias antes</Label>
          <Input
            id="premium_expiry_warning_days"
            name="premium_expiry_warning_days"
            type="number"
            min="1"
            max="365"
            defaultValue={settings.premium_expiry_warning_days}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="premium_expiry_repeat_count">Quantidade de envios</Label>
            <Input
              id="premium_expiry_repeat_count"
              name="premium_expiry_repeat_count"
              type="number"
              min="1"
              max="10"
              defaultValue={settings.premium_expiry_repeat_count}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="premium_expiry_repeat_interval_minutes">
              Intervalo entre envios (minutos)
            </Label>
            <Input
              id="premium_expiry_repeat_interval_minutes"
              name="premium_expiry_repeat_interval_minutes"
              type="number"
              min="1"
              max="10080"
              defaultValue={settings.premium_expiry_repeat_interval_minutes}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="premium_offer_button_label">Texto do botao de acesso Premium</Label>
          <Input
            id="premium_offer_button_label"
            name="premium_offer_button_label"
            maxLength={64}
            defaultValue={settings.premium_offer_button_label}
          />
          <p className="text-xs text-muted-foreground">
            Este texto aparece no submenu fixo e junto com todas as midias enviadas.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="premium_expiry_warning_message">Texto do aviso</Label>
          <Textarea
            id="premium_expiry_warning_message"
            name="premium_expiry_warning_message"
            rows={5}
            maxLength={1000}
            defaultValue={settings.premium_expiry_warning_message}
          />
          <p className="text-xs text-muted-foreground">
            Variaveis: {"{{nome}}"}, {"{{plano}}"}, {"{{dias}}"} e {"{{data}}"}.
          </p>
        </div>
      </form>
    </Card>
  );
}
