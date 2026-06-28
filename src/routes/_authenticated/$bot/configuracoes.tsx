import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  getEnvironmentSettings,
  getImageBotSettings,
  getSettings,
  listImageBotPremiumPlans,
  saveEnvironmentSettings,
  saveImageBotSettings,
  saveSettings,
  sendImageBotTestMessage,
} from "@/lib/api/admin.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUpload } from "@/components/ImageUpload";
import { PanelSubnav } from "@/components/PanelSubnav";
import { toast } from "sonner";
import { useManagedBotPanel } from "@/lib/managed-bot-context";

export const Route = createFileRoute("/_authenticated/$bot/configuracoes")({
  component: Configuracoes,
});

type MenuAction = "plans" | "offers" | "myaccess" | "support" | "terms" | "text" | "url";
type MenuButton = {
  id: string;
  label: string;
  action: MenuAction;
  value: string;
  enabled: boolean;
};

const DEFAULT_BUTTONS: MenuButton[] = [
  { id: "plans", label: "💎 Ver planos", action: "plans", value: "", enabled: true },
  { id: "offers", label: "🎁 Ofertas e combos", action: "offers", value: "", enabled: true },
  { id: "terms", label: "📜 Termos e regras", action: "terms", value: "", enabled: true },
];

type WelcomeMode = "custom" | "telegram_message" | "telegram_file";
type TelegramFileType = "photo" | "video";

function parseTelegramFileReference(value: unknown) {
  const match = /^telegram-file:\/\/(photo|video)\/(.+)$/i.exec(String(value ?? ""));
  if (!match) return null;
  return {
    type: match[1].toLowerCase() as TelegramFileType,
    fileId: match[2],
  };
}

type ImageBotSettingsData = {
  id: string;
  welcome_message: string;
  welcome_image_url: string | null;
  category_hetero_label: string;
  category_trans_label: string;
  photo_button_label: string;
  video_button_label: string;
  random_button_label: string;
  back_button_label: string;
  favorites_button_label: string;
  category_prompt: string;
  media_prompt: string;
  category_required_message: string;
  empty_media_message: string;
  favorites_empty_message: string;
  rate_limit_message: string;
  daily_limit_message: string;
  maintenance_enabled: boolean;
  maintenance_message: string;
  flood_cooldown_seconds: number;
  flood_limit_per_minute: number;
  daily_media_limit: number;
  operating_hours_enabled: boolean;
  operating_start: string;
  operating_end: string;
  outside_hours_message: string;
  auto_message_enabled: boolean;
  auto_message_every: number;
  auto_message_text: string;
  auto_message_plan_mode: "none" | "all" | "single";
  auto_message_plan_id: string | null;
  payment_enabled: boolean;
  payment_hetero_price: number;
  payment_trans_price: number;
  payment_access_days: number;
  payment_prompt: string;
  payment_success_message: string;
  limit_upgrade_enabled: boolean;
  limit_upgrade_button_label: string;
  limit_upgrade_price: number;
  limit_upgrade_bonus_count: number;
  limit_upgrade_access_type: "days" | "lifetime";
  limit_upgrade_access_days: number;
};

type ImageBotSettingsSection =
  | "welcome"
  | "languages"
  | "buttons"
  | "texts"
  | "automation"
  | "system"
  | "test";

const imageBotSettingsSections: { value: ImageBotSettingsSection; label: string }[] = [
  { value: "welcome", label: "Boas-vindas" },
  { value: "languages", label: "Idiomas" },
  { value: "buttons", label: "Botões" },
  { value: "texts", label: "Textos" },
  { value: "automation", label: "Automação" },
  { value: "system", label: "Sistema" },
  { value: "test", label: "Teste" },
];

function Configuracoes() {
  const bot = useManagedBotPanel();
  return bot.kind === "images" ? <ImageBotSettings /> : <SalesBotSettings />;
}

function ImageBotSettings() {
  const qc = useQueryClient();
  const getFn = useServerFn(getImageBotSettings);
  const plansFn = useServerFn(listImageBotPremiumPlans);
  const saveFn = useServerFn(saveImageBotSettings);
  const testFn = useServerFn(sendImageBotTestMessage);
  const { data: settings } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-settings"],
      queryFn: () => getFn() as Promise<ImageBotSettingsData>,
    }),
  );
  const { data: premiumPlans } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-premium-plans"],
      queryFn: () => plansFn() as Promise<Array<{ id: string; name: string; is_active: boolean }>>,
    }),
  );
  const [imageUrl, setImageUrl] = useState(settings.welcome_image_url ?? "");
  const [autoMessageEnabled, setAutoMessageEnabled] = useState(settings.auto_message_enabled);
  const [autoMessagePlanMode, setAutoMessagePlanMode] = useState<"none" | "all" | "single">(
    settings.auto_message_plan_mode ?? "none",
  );
  const [autoMessagePlanId, setAutoMessagePlanId] = useState(settings.auto_message_plan_id ?? "");
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(settings.maintenance_enabled);
  const [activeSection, setActiveSection] = useState<ImageBotSettingsSection>("welcome");
  const save = useMutation({
    mutationFn: (payload: ImageBotSettingsData) => saveFn({ data: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["image-bot-settings"] });
      toast.success("Configurações do bot salvas");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const test = useMutation({
    mutationFn: (payload: { telegram_user_id: number; message: string }) =>
      testFn({ data: payload }),
    onSuccess: () => toast.success("Mensagem de teste enviada"),
    onError: (error: Error) => toast.error(error.message),
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const numberValue = (name: string, fallback: number) => {
      const value = Number(form.get(name) || fallback);
      return Number.isFinite(value) ? value : fallback;
    };
    save.mutate({
      id: settings.id,
      welcome_message: String(form.get("welcome_message") || "").trim(),
      welcome_image_url: imageUrl || null,
      category_hetero_label: String(form.get("category_hetero_label") || "").trim(),
      category_trans_label: String(form.get("category_trans_label") || "").trim(),
      photo_button_label: settings.photo_button_label,
      video_button_label: settings.video_button_label,
      random_button_label: String(form.get("random_button_label") || "").trim(),
      back_button_label: String(form.get("back_button_label") || "").trim(),
      favorites_button_label: String(form.get("favorites_button_label") || "").trim(),
      category_prompt: String(form.get("category_prompt") || "").trim(),
      media_prompt: String(form.get("media_prompt") || "").trim(),
      category_required_message: String(form.get("category_required_message") || "").trim(),
      empty_media_message: String(form.get("empty_media_message") || "").trim(),
      favorites_empty_message: String(form.get("favorites_empty_message") || "").trim(),
      rate_limit_message: String(form.get("rate_limit_message") || "").trim(),
      daily_limit_message: settings.daily_limit_message,
      maintenance_enabled: maintenanceEnabled,
      maintenance_message: String(form.get("maintenance_message") || "").trim(),
      flood_cooldown_seconds: settings.flood_cooldown_seconds,
      flood_limit_per_minute: settings.flood_limit_per_minute,
      daily_media_limit: settings.daily_media_limit,
      operating_hours_enabled: false,
      operating_start: settings.operating_start,
      operating_end: settings.operating_end,
      outside_hours_message: settings.outside_hours_message,
      auto_message_enabled: autoMessageEnabled,
      auto_message_every: numberValue("auto_message_every", 0),
      auto_message_text: String(form.get("auto_message_text") || "").trim(),
      auto_message_plan_mode: autoMessagePlanMode,
      auto_message_plan_id: autoMessagePlanMode === "single" ? autoMessagePlanId || null : null,
      payment_enabled: false,
      payment_hetero_price: 0,
      payment_trans_price: 0,
      payment_access_days: settings.payment_access_days,
      payment_prompt: settings.payment_prompt,
      payment_success_message: settings.payment_success_message,
      limit_upgrade_enabled: settings.limit_upgrade_enabled,
      limit_upgrade_button_label: settings.limit_upgrade_button_label,
      limit_upgrade_price: settings.limit_upgrade_price,
      limit_upgrade_bonus_count: settings.limit_upgrade_bonus_count,
      limit_upgrade_access_type: settings.limit_upgrade_access_type,
      limit_upgrade_access_days: settings.limit_upgrade_access_days,
    });
  }

  function handleTestSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const telegramUserId = Number(form.get("test_telegram_user_id"));
    const message = String(form.get("test_message") || "").trim();
    if (!telegramUserId || telegramUserId < 1) {
      toast.error("Informe o ID do Telegram que vai receber o teste");
      return;
    }
    test.mutate({ telegram_user_id: telegramUserId, message });
  }

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl font-semibold">Configurações do UpMidias</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Personalize a mensagem enviada quando alguém iniciar o bot.
      </p>

      <Card className="mt-6 flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm text-muted-foreground">
          A mensagem e a imagem abaixo pertencem somente ao bot de imagens.
        </div>
      </Card>

      <PanelSubnav
        className="mt-6"
        items={imageBotSettingsSections}
        active={activeSection}
        onChange={setActiveSection}
      />

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <div className={activeSection !== "welcome" ? "panel-section-hidden" : undefined}>
          <Card className="space-y-4 p-6">
            <h2 className="font-display text-lg font-semibold">Boas-vindas</h2>
            <div className="space-y-2">
              <Label htmlFor="image_welcome_message">Mensagem inicial</Label>
              <Textarea
                id="image_welcome_message"
                name="welcome_message"
                rows={6}
                maxLength={4000}
                required
                defaultValue={settings.welcome_message}
                placeholder="Escreva a mensagem que aparecerá no /start"
              />
            </div>
            <div className="space-y-2">
              <Label>Imagem de boas-vindas</Label>
              <p className="text-xs text-muted-foreground">
                Opcional. Envie uma imagem ou cole um link HTTPS.
              </p>
              <ImageUpload value={imageUrl} onChange={setImageUrl} />
            </div>
          </Card>
        </div>

        <div className={activeSection !== "languages" ? "panel-section-hidden" : undefined}>
          <Card className="space-y-4 p-6">
            <div>
              <h2 className="font-display text-lg font-semibold">Idiomas dos usuários</h2>
              <p className="text-sm text-muted-foreground">
                O UpMidias detecta o idioma configurado no Telegram e permite a troca manual pelo
                teclado do bot.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="font-medium">🇧🇷 Português</div>
                <div className="mt-1 text-xs text-muted-foreground">Idioma padrão</div>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="font-medium">🇺🇸 English</div>
                <div className="mt-1 text-xs text-muted-foreground">Tradução automática ativa</div>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="font-medium">🇪🇸 Español</div>
                <div className="mt-1 text-xs text-muted-foreground">Tradução automática ativa</div>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="font-medium">🇸🇦 العربية</div>
                <div className="mt-1 text-xs text-muted-foreground">Tradução automática ativa</div>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="font-medium">🇷🇺 Русский</div>
                <div className="mt-1 text-xs text-muted-foreground">Tradução automática ativa</div>
              </div>
              <div className="rounded-2xl border bg-muted/30 p-4">
                <div className="font-medium">🇹🇭 ไทย</div>
                <div className="mt-1 text-xs text-muted-foreground">Tradução automática ativa</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              As mensagens personalizadas em português continuam sendo usadas para usuários em
              português. Os outros idiomas usam as traduções internas do sistema.
            </p>
          </Card>
        </div>

        <div className={activeSection !== "buttons" ? "panel-section-hidden" : undefined}>
          <Card className="space-y-4 p-6">
            <div>
              <h2 className="font-display text-lg font-semibold">Botões fixos</h2>
              <p className="text-sm text-muted-foreground">
                Altere os nomes dos botões que aparecem no teclado do Telegram.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category_hetero_label">Botão categoria 1</Label>
                <Input
                  id="category_hetero_label"
                  name="category_hetero_label"
                  maxLength={40}
                  defaultValue={settings.category_hetero_label}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category_trans_label">Botão categoria 2</Label>
                <Input
                  id="category_trans_label"
                  name="category_trans_label"
                  maxLength={40}
                  defaultValue={settings.category_trans_label}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="random_button_label">Botão Receba vídeos</Label>
                <Input
                  id="random_button_label"
                  name="random_button_label"
                  maxLength={40}
                  defaultValue={settings.random_button_label}
                />
                <p className="text-xs text-muted-foreground">
                  Fica do lado direito do teclado e envia uma mídia aleatória da categoria
                  escolhida.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="favorites_button_label">Botão Favoritos</Label>
                <Input
                  id="favorites_button_label"
                  name="favorites_button_label"
                  maxLength={40}
                  defaultValue={settings.favorites_button_label}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="back_button_label">Botão voltar</Label>
                <Input
                  id="back_button_label"
                  name="back_button_label"
                  maxLength={40}
                  defaultValue={settings.back_button_label}
                />
              </div>
            </div>
          </Card>
        </div>

        <div className={activeSection !== "texts" ? "panel-section-hidden" : undefined}>
          <Card className="space-y-4 p-6">
            <div>
              <h2 className="font-display text-lg font-semibold">Textos do fluxo</h2>
              <p className="text-sm text-muted-foreground">
                Use <code>{"{{categoria}}"}</code> para inserir o nome da categoria escolhida.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="category_prompt">Texto do menu inicial</Label>
                <Input
                  id="category_prompt"
                  name="category_prompt"
                  defaultValue={settings.category_prompt}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="media_prompt">Texto ao escolher categoria</Label>
                <Input id="media_prompt" name="media_prompt" defaultValue={settings.media_prompt} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category_required_message">Sem categoria escolhida</Label>
                <Textarea
                  id="category_required_message"
                  name="category_required_message"
                  rows={3}
                  defaultValue={settings.category_required_message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="empty_media_message">Sem mídia disponível</Label>
                <Textarea
                  id="empty_media_message"
                  name="empty_media_message"
                  rows={3}
                  defaultValue={settings.empty_media_message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="favorites_empty_message">Sem favoritos</Label>
                <Textarea
                  id="favorites_empty_message"
                  name="favorites_empty_message"
                  rows={3}
                  defaultValue={settings.favorites_empty_message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rate_limit_message">Mensagem contra flood</Label>
                <Textarea
                  id="rate_limit_message"
                  name="rate_limit_message"
                  rows={3}
                  defaultValue={settings.rate_limit_message}
                />
              </div>
            </div>
          </Card>
        </div>

        <div className={activeSection !== "automation" ? "panel-section-hidden" : undefined}>
          <Card className="space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Switch checked={autoMessageEnabled} onCheckedChange={setAutoMessageEnabled} />
              <div>
                <h2 className="font-display text-lg font-semibold">
                  Mensagem automática por pedidos
                </h2>
                <p className="text-sm text-muted-foreground">
                  Envie uma mensagem após uma quantidade acumulada de mídias solicitadas.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="auto_message_every">Enviar a cada quantos pedidos</Label>
              <Input
                id="auto_message_every"
                name="auto_message_every"
                type="number"
                min="0"
                max="10000"
                defaultValue={settings.auto_message_every}
              />
              <p className="text-xs text-muted-foreground">Use 0 para não disparar.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="auto_message_text">Texto automático</Label>
              <Textarea
                id="auto_message_text"
                name="auto_message_text"
                rows={4}
                maxLength={4000}
                defaultValue={settings.auto_message_text}
                placeholder="Ex: Gostou? Favorite as melhores mídias para ver depois."
              />
            </div>
            <div className="space-y-2">
              <Label>Botao de planos</Label>
              <Select
                value={autoMessagePlanMode}
                onValueChange={(value) => {
                  setAutoMessagePlanMode(value as "none" | "all" | "single");
                  if (value !== "single") setAutoMessagePlanId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem botao de plano</SelectItem>
                  <SelectItem value="all">Mostrar todos os planos</SelectItem>
                  <SelectItem value="single">Mostrar somente um plano</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {autoMessagePlanMode === "single" && (
              <div className="space-y-2">
                <Label>Plano exibido na mensagem</Label>
                <Select value={autoMessagePlanId} onValueChange={setAutoMessagePlanId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha um plano ativo" />
                  </SelectTrigger>
                  <SelectContent>
                    {premiumPlans
                      .filter((plan) => plan.is_active)
                      .map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </Card>
        </div>

        <div className={activeSection !== "system" ? "panel-section-hidden" : undefined}>
          <Card className="space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Switch checked={maintenanceEnabled} onCheckedChange={setMaintenanceEnabled} />
              <div>
                <h2 className="font-display text-lg font-semibold">Modo manutenção</h2>
                <p className="text-sm text-muted-foreground">
                  Fora da manutenção, o bot permanece disponível 24 horas por dia.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maintenance_message">Mensagem de manutenção</Label>
              <Textarea
                id="maintenance_message"
                name="maintenance_message"
                rows={4}
                maxLength={1000}
                required
                defaultValue={settings.maintenance_message}
              />
            </div>
          </Card>
        </div>

        {activeSection !== "test" && (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando..." : "Salvar configurações"}
          </Button>
        )}
      </form>

      <form
        onSubmit={handleTestSubmit}
        className={activeSection !== "test" ? "mt-6 panel-section-hidden" : "mt-6"}
      >
        <Card className="hidden">
          <div>
            <h2 className="font-display text-lg font-semibold">Testar mensagem</h2>
            <p className="text-sm text-muted-foreground">
              Envie um texto direto para um ID do Telegram sem sair do painel.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="test_telegram_user_id">ID do Telegram</Label>
              <Input id="test_telegram_user_id" name="test_telegram_user_id" type="number" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="test_message">Mensagem</Label>
              <Textarea
                id="test_message"
                name="test_message"
                rows={3}
                maxLength={4000}
                placeholder="Mensagem de teste..."
              />
            </div>
          </div>
          <Button type="submit" variant="outline" disabled={test.isPending}>
            {test.isPending ? "Enviando..." : "Enviar teste"}
          </Button>
        </Card>
      </form>

      <EnvironmentSettingsPanel />
    </div>
  );
}

function SalesBotSettings() {
  const bot = useManagedBotPanel();
  const qc = useQueryClient();
  const getFn = useServerFn(getSettings);
  const saveFn = useServerFn(saveSettings);

  const { data: settings } = useSuspenseQuery(
    queryOptions({ queryKey: ["settings"], queryFn: () => getFn() as Promise<any> }),
  );

  const storedTelegramFile = parseTelegramFileReference(settings.welcome_image_url);
  const [imageUrl, setImageUrl] = useState<string>(
    storedTelegramFile ? "" : (settings.welcome_image_url ?? ""),
  );
  const [telegramFileId, setTelegramFileId] = useState(storedTelegramFile?.fileId ?? "");
  const [telegramFileType, setTelegramFileType] = useState<TelegramFileType>(
    storedTelegramFile?.type ?? "video",
  );
  const [welcomeMode, setWelcomeMode] = useState<WelcomeMode>(
    settings.welcome_mode === "telegram_message"
      ? "telegram_message"
      : storedTelegramFile
        ? "telegram_file"
        : "custom",
  );
  const fromDb = Array.isArray(settings.menu_buttons) ? settings.menu_buttons : null;
  const buttons =
    fromDb && fromDb.length
      ? fromDb
          .filter((button: any) => {
            const action = String(button.action ?? button.id);
            return (
              !["contents", "myaccess", "support"].includes(action) && button.id !== "contents"
            );
          })
          .map((button: any) => ({
            ...button,
            action: button.action ?? button.id,
            value: button.value ?? "",
          }))
      : DEFAULT_BUTTONS;
  const menuButtons = buttons.length ? buttons : DEFAULT_BUTTONS;

  const save = useMutation({
    mutationFn: (p: any) => saveFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Configurações salvas");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const sourceChatId = String(f.get("welcome_source_chat_id") || "").trim();
    const sourceMessageId = String(f.get("welcome_source_message_id") || "").trim();
    const cleanTelegramFileId = telegramFileId.trim();
    save.mutate({
      id: settings.id,
      welcome_message: String(f.get("welcome_message") || settings.welcome_message || "Bem-vindo"),
      welcome_image_url:
        welcomeMode === "custom"
          ? imageUrl || null
          : welcomeMode === "telegram_file" && cleanTelegramFileId
            ? `telegram-file://${telegramFileType}/${cleanTelegramFileId}`
            : null,
      welcome_mode: welcomeMode === "telegram_message" ? "telegram_message" : "custom",
      welcome_source_chat_id:
        welcomeMode === "telegram_message" && sourceChatId ? Number(sourceChatId) : null,
      welcome_source_message_id:
        welcomeMode === "telegram_message" && sourceMessageId ? Number(sourceMessageId) : null,
      terms_text: settings.terms_text ?? "",
      support_link: settings.support_link ?? "",
      private_group_link: settings.private_group_link ?? "",
      payment_info: settings.payment_info ?? "",
      renewal_notice_days: settings.renewal_notice_days ?? 3,
      expiration_message: settings.expiration_message ?? "",
      menu_buttons: menuButtons,
    });
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Configurações do bot</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure a mensagem e a midia exibidas quando o usuario inicia o bot.
      </p>

      <Card className="mt-6 flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Token do bot:</span> está armazenado com
          segurança no servidor (nunca exposto no navegador). Para trocar o token, peça ao
          assistente para atualizá-lo.
        </div>
      </Card>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <Card className="space-y-5 p-6">
          <div>
            <h2 className="font-display text-lg font-semibold">Boas-vindas</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Esta mensagem aparece no /start junto com as ofertas e os planos ativos.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Origem da mensagem</Label>
            <Select
              value={welcomeMode}
              onValueChange={(value) => setWelcomeMode(value as WelcomeMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Texto + foto ou video do painel</SelectItem>
                <SelectItem value="telegram_message">Mensagem pronta do Telegram</SelectItem>
                <SelectItem value="telegram_file">File ID do Telegram</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {welcomeMode === "custom" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="welcome_message">Mensagem inicial do bot</Label>
                <Textarea
                  id="welcome_message"
                  name="welcome_message"
                  rows={4}
                  defaultValue={settings.welcome_message}
                />
              </div>
              <div className="space-y-2">
                <Label>Foto ou video de boas-vindas</Label>
                <p className="text-xs text-muted-foreground">
                  Envie uma foto ou video de ate 60 MB, ou cole um link publico.
                </p>
                <ImageUpload
                  value={imageUrl}
                  onChange={setImageUrl}
                  accept="image/*,video/mp4,video/quicktime,video/webm"
                  buttonLabel="Enviar foto ou video"
                  allowedKinds={["image", "video"]}
                  maxSizeMb={60}
                />
              </div>
            </>
          ) : welcomeMode === "telegram_file" ? (
            <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
              <div>
                <p className="font-medium">Mídia pelo File ID do Telegram</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Envia a mídia já armazenada pelo Telegram sem hospedar o arquivo novamente.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="welcome_file_message">Mensagem inicial do bot</Label>
                <Textarea
                  id="welcome_file_message"
                  name="welcome_message"
                  rows={4}
                  defaultValue={settings.welcome_message}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                <div className="space-y-2">
                  <Label>Tipo da mídia</Label>
                  <Select
                    value={telegramFileType}
                    onValueChange={(value) => setTelegramFileType(value as TelegramFileType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="video">Vídeo</SelectItem>
                      <SelectItem value="photo">Foto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="welcome_telegram_file_id">File ID</Label>
                  <Input
                    id="welcome_telegram_file_id"
                    value={telegramFileId}
                    onChange={(event) => setTelegramFileId(event.target.value)}
                    placeholder="BAACAgEAAxkB..."
                    required
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
              <input
                type="hidden"
                name="welcome_message"
                value={settings.welcome_message || "Bem-vindo"}
              />
              <div>
                <p className="font-medium">Mensagem pronta do Telegram</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Informe o chat e o ID da mensagem. O bot copia foto, video, legenda ou texto e
                  adiciona os botoes dos planos. Ele precisa ter acesso ao chat de origem.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="welcome_source_chat_id">ID do chat de origem</Label>
                  <Input
                    id="welcome_source_chat_id"
                    name="welcome_source_chat_id"
                    type="number"
                    placeholder="-1001234567890"
                    defaultValue={settings.welcome_source_chat_id ?? ""}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="welcome_source_message_id">ID da mensagem</Label>
                  <Input
                    id="welcome_source_message_id"
                    name="welcome_source_message_id"
                    type="number"
                    min={1}
                    placeholder="123"
                    defaultValue={settings.welcome_source_message_id ?? ""}
                    required
                  />
                </div>
              </div>
            </div>
          )}
        </Card>

        <Button type="submit" disabled={save.isPending}>
          Salvar configurações
        </Button>
      </form>

      {!bot.is_custom && <EnvironmentSettingsPanel />}
    </div>
  );
}

type EnvSetting = {
  key: string;
  label: string;
  description: string;
  group: "bots" | "payments" | "urls";
  value: string;
  configured: boolean;
  known: boolean;
  secret?: boolean;
  reconnectBots?: boolean;
};

const envGroupLabels: Record<EnvSetting["group"], string> = {
  bots: "Bots",
  urls: "URLs e webhooks",
  payments: "Mercado Pago",
};

function EnvironmentSettingsPanel() {
  const bot = useManagedBotPanel();
  const qc = useQueryClient();
  const getFn = useServerFn(getEnvironmentSettings);
  const saveFn = useServerFn(saveEnvironmentSettings);
  const { data } = useSuspenseQuery(
    queryOptions({
      queryKey: ["environment-settings", bot.key],
      queryFn: () =>
        getFn({ data: { bot_key: bot.kind } }) as Promise<{
          env_path: string;
          webhook_urls: {
            telegram: string;
            mercado_pago: string;
          };
          settings: EnvSetting[];
        }>,
    }),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.settings.map((setting) => [setting.key, setting.value ?? ""])),
  );
  const [showSecrets, setShowSecrets] = useState(false);
  useEffect(() => {
    setValues(
      Object.fromEntries(data.settings.map((setting) => [setting.key, setting.value ?? ""])),
    );
  }, [data.settings]);
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          bot_key: bot.kind,
          confirmation: "SALVAR_ENV",
          values,
        },
      }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["environment-settings", bot.key] });
      const changed = result?.changed_keys?.length ?? 0;
      const reconnect = result?.reconnect_bot_keys?.length ?? 0;
      toast.success(
        `Variáveis salvas (${changed} alterada${changed === 1 ? "" : "s"})${
          reconnect ? ". Reinicie este bot em /bots." : ""
        }`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const groups = data.settings.reduce(
    (acc, setting) => {
      if (!acc[setting.group]) acc[setting.group] = [];
      acc[setting.group].push(setting);
      return acc;
    },
    {} as Record<EnvSetting["group"], EnvSetting[]>,
  );

  function setValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = window.confirm(
      "Salvar variáveis do .env pelo painel é sensível. Confirma que deseja aplicar agora?",
    );
    if (!ok) return;
    save.mutate();
  }

  return (
    <Card className="mt-8 space-y-5 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Sistema e .env</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Edite somente o token deste bot, URLs/webhooks e Mercado Pago.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Arquivo: {data.env_path}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setShowSecrets((value) => !value)}>
          {showSecrets ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
          {showSecrets ? "Ocultar" : "Mostrar"} segredos
        </Button>
      </div>

      <Card className="border-destructive/20 bg-destructive/5 p-4 text-sm text-muted-foreground">
        O token mostrado aqui pertence somente ao bot aberto agora. O token do outro bot nao e
        enviado para esta tela.
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4">
          <Label className="text-xs text-muted-foreground">Webhook Telegram deste bot</Label>
          <p className="mt-2 break-all font-mono text-xs">{data.webhook_urls.telegram || "-"}</p>
        </Card>
        <Card className="p-4">
          <Label className="text-xs text-muted-foreground">Webhook Mercado Pago</Label>
          <p className="mt-2 break-all font-mono text-xs">
            {data.webhook_urls.mercado_pago || "-"}
          </p>
        </Card>
      </div>

      <form onSubmit={submit} className="space-y-6">
        {(Object.keys(envGroupLabels) as EnvSetting["group"][]).map((group) => {
          const items = groups[group] ?? [];
          if (!items.length) return null;
          return (
            <div key={group} className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {envGroupLabels[group]}
              </h3>
              <div className="space-y-3">
                {items.map((setting) => (
                  <div key={setting.key} className="rounded-3xl border bg-white p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <Label htmlFor={`env_${setting.key}`} className="font-semibold">
                        {setting.label}
                      </Label>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {setting.secret && (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                            segredo
                          </span>
                        )}
                        {setting.reconnectBots && (
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">
                            reinicie o bot
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
                    <Input
                      id={`env_${setting.key}`}
                      className="mt-3 font-mono text-xs"
                      type={setting.secret && !showSecrets ? "password" : "text"}
                      value={values[setting.key] ?? ""}
                      placeholder={setting.key}
                      onChange={(event) => setValue(setting.key, event.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">{setting.key}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando .env..." : "Salvar variáveis do sistema"}
        </Button>
      </form>
    </Card>
  );
}
