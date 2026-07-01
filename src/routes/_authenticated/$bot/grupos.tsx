import { createFileRoute } from "@tanstack/react-router";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  AlertTriangle,
  Database,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LogOut,
  MessagesSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ImageUpload } from "@/components/ImageUpload";
import { PanelSubnav } from "@/components/PanelSubnav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteImageBotGroupAutomation,
  deleteGroupBroadcast,
  listImageBotGroupAutomations,
  listImageBotGroups,
  listImageBotMedia,
  listGroupBroadcasts,
  listImageBotPremiumPlans,
  listPlans,
  listTelegramGroups,
  leaveImageBotGroup,
  leaveTelegramGroup,
  saveGroupBroadcast,
  saveImageBotGroupAutomation,
  sendImageBotGroupAutomationNow,
  sendGroupBroadcastNow,
} from "@/lib/api/admin.functions";
import { useManagedBotPanel } from "@/lib/managed-bot-context";

export const Route = createFileRoute("/_authenticated/$bot/grupos")({
  component: Grupos,
});

type TelegramGroup = {
  id: string;
  telegram_chat_id: number;
  title: string;
  username: string | null;
  type: "group" | "supergroup" | "channel";
  category?: "hetero" | "trans" | null;
  bot_status: string;
  is_active: boolean;
  member_count: number | null;
  joined_at: string | null;
  left_at: string | null;
  last_activity_at: string | null;
};

type GroupBroadcast = {
  id: string;
  group_id: string;
  title: string;
  message: string;
  image_url: string | null;
  buttons: GroupButton[];
  interval_minutes: number;
  is_active: boolean;
  last_sent_at: string | null;
};

type ImageAutomationContentKind =
  | "text"
  | "custom_photo"
  | "custom_video"
  | "saved_media"
  | "telegram_message";

type ImageGroupAutomation = {
  id: string;
  group_id: string;
  title: string;
  message: string;
  content_kind: ImageAutomationContentKind;
  custom_media_url: string | null;
  saved_media_id: string | null;
  random_media_category: "hetero" | "trans" | null;
  media_batch_size: number;
  source_chat_id: number | null;
  source_message_id: number | null;
  buttons: ImageAutomationButton[];
  interval_minutes: number;
  is_active: boolean;
  last_sent_at: string | null;
  saved_media_category: "hetero" | "trans" | null;
  saved_media_type: "photo" | "video" | null;
  saved_media_caption: string | null;
  saved_media_is_active: boolean | null;
};

type ImageAutomationButton = {
  label: string;
  kind: "premium_plans" | "premium_plan" | "bot_link";
  plan_id?: string | null;
  url?: string | null;
};

type ImageMediaOption = {
  id: string;
  category: "hetero" | "trans";
  media_type: "photo" | "video";
  caption: string | null;
  telegram_message_id: number;
  telegram_chat_id: number;
  is_active: boolean;
  created_at: string;
};

type ButtonKind = "link" | "bot" | "plans" | "plan" | "offers";
type GroupButton = {
  label: string;
  kind: ButtonKind;
  url?: string | null;
  plan_id?: string | null;
};

const buttonKindLabels: Record<ButtonKind, string> = {
  link: "Link externo",
  bot: "Abrir bot do Telegram",
  plans: "Abrir planos",
  plan: "Abrir um plano",
  offers: "Abrir ofertas",
};

const statusLabels: Record<string, string> = {
  creator: "Criador",
  administrator: "Administrador",
  member: "Membro",
  restricted: "Restrito",
  left: "Saiu",
  kicked: "Removido",
};

const imageContentKindLabels: Record<ImageAutomationContentKind, string> = {
  text: "Texto",
  custom_photo: "Foto personalizada",
  custom_video: "Vídeo personalizado",
  saved_media: "Mídia do banco",
  telegram_message: "Mensagem por ID",
};

const imageContentKindIcons: Record<ImageAutomationContentKind, typeof FileText> = {
  text: FileText,
  custom_photo: ImageIcon,
  custom_video: Video,
  saved_media: Database,
  telegram_message: MessagesSquare,
};

type GroupSection = "summary" | "groups";

const groupSections: { value: GroupSection; label: string }[] = [
  { value: "summary", label: "Resumo" },
  { value: "groups", label: "Grupos" },
];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

function normalizeTelegramBotUrl(value: string | null | undefined) {
  const input = value?.trim() ?? "";
  if (!input) return null;
  const username = input
    .replace(/^https?:\/\/(?:t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/, 1)[0];
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  return `https://t.me/${username}`;
}

function Grupos() {
  const bot = useManagedBotPanel();
  return bot.kind === "images" ? <ImageBotGroups /> : <SalesBotGroups />;
}

function ImageBotGroups() {
  const qc = useQueryClient();
  const listFn = useServerFn(listImageBotGroups);
  const listAutomationsFn = useServerFn(listImageBotGroupAutomations);
  const saveAutomationFn = useServerFn(saveImageBotGroupAutomation);
  const deleteAutomationFn = useServerFn(deleteImageBotGroupAutomation);
  const sendAutomationFn = useServerFn(sendImageBotGroupAutomationNow);
  const listMediaFn = useServerFn(listImageBotMedia);
  const listPremiumPlansFn = useServerFn(listImageBotPremiumPlans);
  const leaveGroupFn = useServerFn(leaveImageBotGroup);
  const groupsQuery = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-groups"],
      queryFn: () => listFn() as Promise<TelegramGroup[]>,
      refetchInterval: 15_000,
    }),
  );
  const groups = groupsQuery.data;
  const { data: premiumPlans } = useSuspenseQuery(
    queryOptions({
      queryKey: ["image-bot-premium-plans"],
      queryFn: () =>
        listPremiumPlansFn() as Promise<Array<{ id: string; name: string; is_active: boolean }>>,
    }),
  );
  const activeGroups = groups.filter((group) => group.is_active).length;
  const activeChannels = groups.filter(
    (group) => group.is_active && group.type === "channel",
  ).length;
  const needsMediaPermission = groups.some(
    (group) => group.is_active && !["creator", "administrator"].includes(group.bot_status),
  );
  const [activeSection, setActiveSection] = useState<GroupSection>("summary");
  const [selectedGroup, setSelectedGroup] = useState<TelegramGroup | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ImageGroupAutomation | null>(null);
  const [contentKind, setContentKind] = useState<ImageAutomationContentKind>("text");
  const [customMediaUrl, setCustomMediaUrl] = useState("");
  const [automationButtons, setAutomationButtons] = useState<ImageAutomationButton[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [randomMediaCategory, setRandomMediaCategory] = useState<"hetero" | "trans">("hetero");

  const automationsQuery = useQuery({
    queryKey: ["image-bot-group-automations", selectedGroup?.id],
    queryFn: () =>
      listAutomationsFn({
        data: { group_id: selectedGroup!.id },
      }) as Promise<ImageGroupAutomation[]>,
    enabled: Boolean(selectedGroup),
    refetchInterval: selectedGroup ? 15_000 : false,
  });

  const mediaQuery = useQuery({
    queryKey: ["image-bot-media"],
    queryFn: () => listMediaFn() as Promise<ImageMediaOption[]>,
    enabled: false,
  });

  const refreshAutomations = () => {
    if (selectedGroup) {
      qc.invalidateQueries({ queryKey: ["image-bot-group-automations", selectedGroup.id] });
    }
  };

  const saveAutomation = useMutation({
    mutationFn: (data: any) => saveAutomationFn({ data }),
    onSuccess: () => {
      refreshAutomations();
      setEditorOpen(false);
      toast.success("Automação do grupo salva");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const removeAutomation = useMutation({
    mutationFn: (id: string) => deleteAutomationFn({ data: { id, group_id: selectedGroup!.id } }),
    onSuccess: () => {
      refreshAutomations();
      toast.success("Automação excluída");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const sendAutomationNow = useMutation({
    mutationFn: (id: string) => sendAutomationFn({ data: { id, group_id: selectedGroup!.id } }),
    onSuccess: () => {
      refreshAutomations();
      toast.success("Automação enviada ao grupo");
    },
    onError: (error: any) => toast.error(error.message),
  });
  const leaveGroup = useMutation({
    mutationFn: (groupId: string) => leaveGroupFn({ data: { group_id: groupId } }),
    onSuccess: () => {
      setSelectedGroup(null);
      qc.invalidateQueries({ queryKey: ["image-bot-groups"] });
      toast.success("UpMídias removido do grupo ou canal");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const automations = automationsQuery.data ?? [];
  const mediaOptions = mediaQuery.data ?? [];

  function openImageAutomation(group: TelegramGroup) {
    setSelectedGroup(group);
  }

  function openNewImageAutomation() {
    setEditing(null);
    setContentKind("text");
    setCustomMediaUrl("");
    setAutomationButtons([]);
    setRandomMediaCategory(selectedGroup?.category ?? "hetero");
    setEditorOpen(true);
  }

  function openEditImageAutomation(automation: ImageGroupAutomation) {
    setEditing(automation);
    setContentKind(automation.content_kind);
    setCustomMediaUrl(automation.custom_media_url ?? "");
    setAutomationButtons(automation.buttons ?? []);
    setRandomMediaCategory(
      automation.random_media_category ??
        automation.saved_media_category ??
        selectedGroup?.category ??
        "hetero",
    );
    setEditorOpen(true);
  }

  function addImageAutomationButton() {
    setAutomationButtons((current) => [
      ...current,
      { label: "Planos Premium", kind: "premium_plans", plan_id: null },
    ]);
  }

  function updateImageAutomationButton(index: number, patch: Partial<ImageAutomationButton>) {
    setAutomationButtons((current) =>
      current.map((button, position) => (position === index ? { ...button, ...patch } : button)),
    );
  }

  function removeImageAutomationButton(index: number) {
    setAutomationButtons((current) => current.filter((_, position) => position !== index));
  }

  function submitImageAutomation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroup) return;
    const form = new FormData(event.currentTarget);
    const sourceChatValue = String(form.get("source_chat_id") ?? "").trim();
    const sourceMessageValue = String(form.get("source_message_id") ?? "").trim();
    const sourceChatId = sourceChatValue ? Number(sourceChatValue) : null;
    const sourceMessageId = sourceMessageValue ? Number(sourceMessageValue) : null;

    saveAutomation.mutate({
      id: editing?.id,
      group_id: selectedGroup.id,
      title: String(form.get("title")),
      message: String(form.get("message") ?? ""),
      content_kind: contentKind,
      custom_media_url:
        contentKind === "custom_photo" || contentKind === "custom_video" ? customMediaUrl : null,
      saved_media_id: null,
      random_media_category: contentKind === "saved_media" ? randomMediaCategory : null,
      media_batch_size:
        contentKind === "saved_media" ? Number(form.get("media_batch_size") || 1) : 1,
      source_chat_id: contentKind === "telegram_message" ? sourceChatId : null,
      source_message_id: contentKind === "telegram_message" ? sourceMessageId : null,
      buttons: automationButtons
        .filter((button) => button.label.trim())
        .map((button) => ({
          label: button.label.trim(),
          kind: button.kind,
          plan_id: button.kind === "premium_plan" ? button.plan_id : null,
          url: button.kind === "bot_link" ? button.url?.trim() : null,
        })),
      interval_minutes: Number(form.get("interval_minutes")),
      is_active: form.get("is_active") === "on",
    });
  }

  function describeImageAutomation(automation: ImageGroupAutomation) {
    if (automation.content_kind === "saved_media") {
      if (automation.random_media_category) {
        const category = automation.random_media_category === "hetero" ? "Hetero" : "Trans";
        return `Sorteio ${category} · ${automation.media_batch_size} mídia(s) por envio · sem repetir`;
      }
      return automation.saved_media_id
        ? `${automation.saved_media_type === "video" ? "Vídeo" : "Foto"} do banco · ${automation.saved_media_id.slice(0, 8)}`
        : "Mídia do banco não selecionada";
    }
    if (automation.content_kind === "telegram_message") {
      return `Mensagem ID ${automation.source_message_id ?? "não informado"}`;
    }
    if (automation.content_kind === "custom_photo") return "Foto por link/upload";
    if (automation.content_kind === "custom_video") return "Vídeo por link";
    return "Somente texto";
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Grupos e canais</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grupos em que o UpMídias está presente. Gerencie automações por grupo sem misturar com o
            bot de vendas.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => groupsQuery.refetch()}
          disabled={groupsQuery.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${groupsQuery.isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <PanelSubnav
        className="mt-6"
        items={groupSections}
        active={activeSection}
        onChange={setActiveSection}
      />

      <div
        className={
          activeSection !== "summary" ? "panel-section-hidden" : "mt-6 grid gap-4 sm:grid-cols-2"
        }
      >
        <Card className="flex items-center gap-4 p-5">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <UsersRound className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Grupos/canais ativos</div>
            <div className="text-2xl font-semibold">{activeGroups}</div>
            {activeChannels > 0 && (
              <div className="text-xs text-muted-foreground">{activeChannels} canal(is)</div>
            )}
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-5">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Total detectado</div>
            <div className="text-2xl font-semibold">{groups.length}</div>
          </div>
        </Card>
      </div>

      {needsMediaPermission && activeSection === "summary" && (
        <Card className="mt-4 border-amber-300 bg-amber-50 p-4 text-amber-950">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-medium">Permita que o bot receba todas as mídias</div>
              <p className="mt-1 text-sm">
                Torne o UpMídias administrador nos grupos Hetero e Trans. Assim o Telegram entrega
                ao bot todas as fotos e vídeos encaminhados para serem salvos.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className={activeSection !== "groups" ? "panel-section-hidden" : "mt-6 p-0"}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grupo/canal</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Membros</TableHead>
              <TableHead>Status do bot</TableHead>
              <TableHead>Última atividade</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!groups.length && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  Adicione o UpMídias a um grupo. Assim que o Telegram avisar a entrada ou houver
                  atividade, o grupo aparecerá aqui.
                </TableCell>
              </TableRow>
            )}
            {groups.map((group) => (
              <TableRow key={group.id}>
                <TableCell>
                  <div className="font-medium">{group.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {group.username ? `@${group.username}` : `ID ${group.telegram_chat_id}`}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {group.category === "hetero"
                      ? "Hétero"
                      : group.category === "trans"
                        ? "Trans"
                        : "Não definida"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {group.type === "channel"
                    ? "Canal"
                    : group.type === "supergroup"
                      ? "Supergrupo"
                      : "Grupo"}
                </TableCell>
                <TableCell>{group.member_count ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={group.is_active ? "default" : "secondary"}>
                    {statusLabels[group.bot_status] ?? (group.is_active ? "Ativo" : "Inativo")}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDate(group.last_activity_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => openImageAutomation(group)}>
                    <MessagesSquare className="mr-2 h-4 w-4" />
                    Gerenciar
                  </Button>
                  {group.username ? (
                    <Button variant="ghost" size="icon" asChild>
                      <a href={`https://t.me/${group.username}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Privado</span>
                  )}
                  {group.is_active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remover o bot deste grupo ou canal"
                      disabled={leaveGroup.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            `Remover o UpMídias de "${group.title}"? O bot sairá do grupo ou canal.`,
                          )
                        ) {
                          leaveGroup.mutate(group.id);
                        }
                      }}
                    >
                      <LogOut className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={Boolean(selectedGroup)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedGroup(null);
            setEditorOpen(false);
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Gerenciar grupo: {selectedGroup?.title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-4">
            <div>
              <div className="text-sm font-medium">
                {selectedGroup?.member_count ?? "—"} membros · {automations.length} automações
              </div>
              <div className="text-xs text-muted-foreground">
                Envie texto, foto, vídeo, mídia salva do banco ou copie uma mensagem por ID.
              </div>
            </div>
            <Button onClick={openNewImageAutomation} disabled={!selectedGroup?.is_active}>
              <Plus className="mr-2 h-4 w-4" />
              Nova automação
            </Button>
          </div>

          {!selectedGroup?.is_active && (
            <p className="text-sm text-destructive">
              O bot não está ativo neste grupo. Adicione-o novamente para habilitar os envios.
            </p>
          )}

          {automationsQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <Card className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Conteúdo</TableHead>
                    <TableHead>Intervalo</TableHead>
                    <TableHead>Último envio</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!automations.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Nenhuma automação configurada neste grupo.
                      </TableCell>
                    </TableRow>
                  )}
                  {automations.map((automation) => {
                    const Icon = imageContentKindIcons[automation.content_kind];
                    return (
                      <TableRow key={automation.id}>
                        <TableCell>
                          <div className="font-medium">{automation.title}</div>
                          <div className="max-w-80 truncate text-xs text-muted-foreground">
                            {automation.message || "Sem texto adicional"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm">
                            <Icon className="h-4 w-4 text-primary" />
                            <span>{imageContentKindLabels[automation.content_kind]}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {describeImageAutomation(automation)}
                          </div>
                        </TableCell>
                        <TableCell>{automation.interval_minutes} min</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(automation.last_sent_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={automation.is_active ? "default" : "secondary"}>
                            {automation.is_active ? "Ativa" : "Inativa"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Enviar agora"
                            disabled={sendAutomationNow.isPending || !selectedGroup?.is_active}
                            onClick={() => {
                              if (confirm(`Enviar agora para o grupo ${selectedGroup?.title}?`)) {
                                sendAutomationNow.mutate(automation.id);
                              }
                            }}
                          >
                            <Send className="h-4 w-4 text-primary" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditImageAutomation(automation)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm("Excluir esta automação?")) {
                                removeAutomation.mutate(automation.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar automação do UpMídias" : "Nova automação do UpMídias"}
            </DialogTitle>
          </DialogHeader>
          <form
            key={editing?.id ?? "new-image-group-automation"}
            className="space-y-4"
            onSubmit={submitImageAutomation}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="image-group-automation-title">Título interno</Label>
                <Input
                  id="image-group-automation-title"
                  name="title"
                  required
                  defaultValue={editing?.title ?? ""}
                  placeholder="Ex: Chamada diária"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo de conteúdo</Label>
                <Select
                  value={contentKind}
                  onValueChange={(value) => setContentKind(value as ImageAutomationContentKind)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(imageContentKindLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="image-group-automation-message">
                Texto ou legenda {contentKind === "text" ? "" : "(opcional)"}
              </Label>
              <Textarea
                id="image-group-automation-message"
                name="message"
                rows={5}
                required={contentKind === "text"}
                defaultValue={editing?.message ?? ""}
                placeholder="Digite o texto que será enviado ao grupo..."
              />
            </div>

            {contentKind === "custom_photo" && (
              <div className="space-y-2">
                <Label>Foto personalizada</Label>
                <ImageUpload value={customMediaUrl} onChange={setCustomMediaUrl} />
              </div>
            )}

            {contentKind === "custom_video" && (
              <div className="space-y-2">
                <Label htmlFor="image-group-custom-video">Link do vídeo</Label>
                <Input
                  id="image-group-custom-video"
                  value={customMediaUrl}
                  onChange={(event) => setCustomMediaUrl(event.target.value)}
                  placeholder="https://..."
                />
              </div>
            )}

            {contentKind === "saved_media" && (
              <>
                <div className="space-y-3 rounded-2xl border bg-muted/30 p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Categoria para sortear</Label>
                      <Select
                        value={randomMediaCategory}
                        onValueChange={(value) =>
                          setRandomMediaCategory(value as "hetero" | "trans")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hetero">Hetero</SelectItem>
                          <SelectItem value="trans">Trans</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="image-group-media-batch">Quantas mídias por envio</Label>
                      <Input
                        id="image-group-media-batch"
                        name="media_batch_size"
                        type="number"
                        min="1"
                        max={20}
                        required
                        defaultValue={editing?.media_batch_size ?? 1}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    O bot sorteia fotos e vídeos dessa categoria, sem repetir nesta automação até
                    terminar o ciclo. Limite de segurança: 20 mídias por envio.
                  </p>
                </div>
                <div className="hidden">
                  <Label>Mídia salva no banco</Label>
                  <Select value="" onValueChange={() => undefined}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha uma mídia salva" />
                    </SelectTrigger>
                    <SelectContent>
                      {mediaOptions
                        .filter((media) => media.is_active)
                        .map((media) => (
                          <SelectItem key={media.id} value={media.id}>
                            {media.media_type === "video" ? "Vídeo" : "Foto"} · {media.category} ·
                            ID {media.id.slice(0, 8)} · msg {media.telegram_message_id}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Você também pode colar o ID da mídia salva para localizá-la.
                  </p>
                </div>
              </>
            )}

            {contentKind === "telegram_message" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="image-group-source-chat">ID do chat de origem</Label>
                  <Input
                    id="image-group-source-chat"
                    name="source_chat_id"
                    type="number"
                    defaultValue={editing?.source_chat_id ?? selectedGroup?.telegram_chat_id ?? ""}
                    placeholder={String(selectedGroup?.telegram_chat_id ?? "")}
                  />
                  <p className="text-xs text-muted-foreground">
                    Deixe o ID do próprio grupo ou informe outro chat onde o bot consiga ler.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="image-group-source-message">ID da mensagem</Label>
                  <Input
                    id="image-group-source-message"
                    name="source_message_id"
                    type="number"
                    min="1"
                    defaultValue={editing?.source_message_id ?? ""}
                    placeholder="Ex: 123"
                  />
                </div>
              </div>
            )}

            <Card className="space-y-3 border-dashed p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Botões da mensagem</Label>
                  <p className="text-xs text-muted-foreground">
                    Abra planos Premium ou leve o usuário diretamente para outro bot.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addImageAutomationButton}
                  disabled={automationButtons.length >= 6}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Botão
                </Button>
              </div>
              {!automationButtons.length && (
                <p className="text-xs text-muted-foreground">Nenhum botão configurado.</p>
              )}
              {automationButtons.map((button, index) => (
                <div key={index} className="space-y-2 rounded-xl border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={button.label}
                      maxLength={64}
                      onChange={(event) =>
                        updateImageAutomationButton(index, { label: event.target.value })
                      }
                      placeholder="Texto do botão"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeImageAutomationButton(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Select
                    value={button.kind}
                    onValueChange={(value) =>
                      updateImageAutomationButton(index, {
                        kind: value as ImageAutomationButton["kind"],
                        plan_id: value === "premium_plan" ? button.plan_id : null,
                        url: value === "bot_link" ? button.url : null,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="premium_plans">Todos os planos Premium</SelectItem>
                      <SelectItem value="premium_plan">Somente um plano Premium</SelectItem>
                      <SelectItem value="bot_link">Abrir bot pelo link</SelectItem>
                    </SelectContent>
                  </Select>
                  {button.kind === "premium_plan" && (
                    <Select
                      value={button.plan_id ?? ""}
                      onValueChange={(planId) => {
                        const plan = premiumPlans.find((item) => item.id === planId);
                        updateImageAutomationButton(index, {
                          plan_id: planId,
                          label: button.label.trim() || plan?.name || "Ver plano",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha o plano" />
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
                  )}
                  {button.kind === "bot_link" && (
                    <div className="space-y-2">
                      <Label htmlFor={`image-group-bot-link-${index}`}>Link do bot</Label>
                      <Input
                        id={`image-group-bot-link-${index}`}
                        type="url"
                        value={button.url ?? ""}
                        onChange={(event) =>
                          updateImageAutomationButton(index, { url: event.target.value })
                        }
                        placeholder="https://t.me/usuário_do_bot"
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Use o link público do bot. Ao tocar, o usuário abre a conversa no Telegram.
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="image-group-interval">Enviar a cada (minutos)</Label>
                <Input
                  id="image-group-interval"
                  name="interval_minutes"
                  type="number"
                  min="1"
                  max="525600"
                  required
                  defaultValue={editing?.interval_minutes ?? 60}
                />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  id="image-group-active"
                  name="is_active"
                  defaultChecked={editing ? editing.is_active : true}
                />
                <Label htmlFor="image-group-active">Automação ativa</Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={saveAutomation.isPending}>
                Salvar automação
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SalesBotGroups() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTelegramGroups);
  const listMessagesFn = useServerFn(listGroupBroadcasts);
  const saveMessageFn = useServerFn(saveGroupBroadcast);
  const deleteMessageFn = useServerFn(deleteGroupBroadcast);
  const sendMessageFn = useServerFn(sendGroupBroadcastNow);
  const listPlansFn = useServerFn(listPlans);
  const leaveGroupFn = useServerFn(leaveTelegramGroup);
  const groupsQuery = useSuspenseQuery(
    queryOptions({
      queryKey: ["telegram-groups"],
      queryFn: () => listFn() as Promise<TelegramGroup[]>,
      refetchInterval: 15_000,
    }),
  );
  const { data: plans } = useSuspenseQuery(
    queryOptions({
      queryKey: ["plans"],
      queryFn: () =>
        listPlansFn() as Promise<Array<{ id: string; name: string; is_active: boolean }>>,
    }),
  );
  const [selectedGroup, setSelectedGroup] = useState<TelegramGroup | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<GroupBroadcast | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [messageButtons, setMessageButtons] = useState<GroupButton[]>([]);

  const messagesQuery = useQuery({
    queryKey: ["group-broadcasts", selectedGroup?.id],
    queryFn: () =>
      listMessagesFn({ data: { group_id: selectedGroup!.id } }) as Promise<GroupBroadcast[]>,
    enabled: Boolean(selectedGroup),
    refetchInterval: selectedGroup ? 15_000 : false,
  });

  const refreshMessages = () => {
    if (selectedGroup) {
      qc.invalidateQueries({ queryKey: ["group-broadcasts", selectedGroup.id] });
    }
  };
  const saveMessage = useMutation({
    mutationFn: (data: any) => saveMessageFn({ data }),
    onSuccess: () => {
      refreshMessages();
      setEditorOpen(false);
      toast.success("Mensagem automática salva");
    },
    onError: (error: any) => toast.error(error.message),
  });
  const removeMessage = useMutation({
    mutationFn: (id: string) => deleteMessageFn({ data: { id, group_id: selectedGroup!.id } }),
    onSuccess: () => {
      refreshMessages();
      toast.success("Mensagem excluída");
    },
    onError: (error: any) => toast.error(error.message),
  });
  const sendNow = useMutation({
    mutationFn: (id: string) => sendMessageFn({ data: { id, group_id: selectedGroup!.id } }),
    onSuccess: () => {
      refreshMessages();
      toast.success("Mensagem enviada ao grupo");
    },
    onError: (error: any) => toast.error(error.message),
  });
  const leaveGroup = useMutation({
    mutationFn: (groupId: string) => leaveGroupFn({ data: { group_id: groupId } }),
    onSuccess: () => {
      setSelectedGroup(null);
      qc.invalidateQueries({ queryKey: ["telegram-groups"] });
      toast.success("Bot removido do grupo ou canal");
    },
    onError: (error: any) => toast.error(error.message),
  });

  const groups = groupsQuery.data;
  const messages = messagesQuery.data ?? [];
  const activeGroups = groups.filter((group) => group.is_active).length;
  const activeChannels = groups.filter(
    (group) => group.is_active && group.type === "channel",
  ).length;

  function openNewMessage() {
    setEditing(null);
    setImageUrl("");
    setMessageButtons([]);
    setEditorOpen(true);
  }

  function openEditMessage(message: GroupBroadcast) {
    setEditing(message);
    setImageUrl(message.image_url ?? "");
    setMessageButtons(message.buttons ?? []);
    setEditorOpen(true);
  }

  function addMessageButton() {
    setMessageButtons((current) => [...current, { label: "", kind: "link", url: "" }]);
  }

  function updateMessageButton(index: number, patch: Partial<GroupButton>) {
    setMessageButtons((current) =>
      current.map((button, position) => (position === index ? { ...button, ...patch } : button)),
    );
  }

  function removeMessageButton(index: number) {
    setMessageButtons((current) => current.filter((_, position) => position !== index));
  }

  function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroup) return;
    const form = new FormData(event.currentTarget);
    const buttons = messageButtons
      .filter((button) => button.label.trim())
      .map((button) => ({
        label: button.label.trim(),
        kind: button.kind,
        url:
          button.kind === "link"
            ? (button.url ?? "").trim()
            : button.kind === "bot"
              ? normalizeTelegramBotUrl(button.url)
              : null,
        plan_id: button.kind === "plan" ? button.plan_id : null,
      }));
    const invalidLink = buttons.find(
      (button) => button.kind === "link" && !/^https?:\/\/\S+$/i.test(button.url ?? ""),
    );
    if (invalidLink) {
      toast.error(`O botão "${invalidLink.label}" precisa de um link começando com https://`);
      return;
    }
    const invalidBot = buttons.find((button) => button.kind === "bot" && !button.url);
    if (invalidBot) {
      toast.error(`O botão "${invalidBot.label}" precisa do @usuário ou link t.me do bot`);
      return;
    }
    saveMessage.mutate({
      id: editing?.id,
      group_id: selectedGroup.id,
      title: String(form.get("title")),
      message: String(form.get("message") || ""),
      image_url: imageUrl || null,
      buttons,
      interval_minutes: Number(form.get("interval_minutes")),
      is_active: form.get("is_active") === "on",
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Grupos e canais</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Clique em um grupo para administrar mensagens automáticas exclusivas dele.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => groupsQuery.refetch()}
          disabled={groupsQuery.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${groupsQuery.isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card className="flex items-center gap-4 p-5">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <UsersRound className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Grupos/canais ativos</div>
            <div className="text-2xl font-semibold">{activeGroups}</div>
            {activeChannels > 0 && (
              <div className="text-xs text-muted-foreground">{activeChannels} canal(is)</div>
            )}
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-5">
          <div className="rounded-full bg-primary/10 p-3 text-primary">
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Total detectado</div>
            <div className="text-2xl font-semibold">{groups.length}</div>
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grupo/canal</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Membros</TableHead>
              <TableHead>Status do bot</TableHead>
              <TableHead>Última atividade</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!groups.length && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  Adicione o bot a um grupo ou envie um comando em um grupo existente para ele
                  aparecer aqui.
                </TableCell>
              </TableRow>
            )}
            {groups.map((group) => (
              <TableRow
                key={group.id}
                className="cursor-pointer"
                onClick={() => setSelectedGroup(group)}
              >
                <TableCell>
                  <div className="font-medium">{group.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {group.username ? `@${group.username}` : `ID ${group.telegram_chat_id}`}
                  </div>
                </TableCell>
                <TableCell>
                  {group.type === "channel"
                    ? "Canal"
                    : group.type === "supergroup"
                      ? "Supergrupo"
                      : "Grupo"}
                </TableCell>
                <TableCell>{group.member_count ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={group.is_active ? "default" : "secondary"}>
                    {group.is_active
                      ? (statusLabels[group.bot_status] ?? "Ativo")
                      : (statusLabels[group.bot_status] ?? "Inativo")}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDate(group.last_activity_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedGroup(group);
                    }}
                  >
                    <MessagesSquare className="mr-2 h-4 w-4" />
                    Gerenciar
                  </Button>
                  {group.username && (
                    <Button variant="ghost" size="icon" asChild>
                      <a
                        href={`https://t.me/${group.username}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  {group.is_active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Remover o bot deste grupo ou canal"
                      disabled={leaveGroup.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (
                          confirm(`Remover o bot de "${group.title}"? Ele sairá do grupo ou canal.`)
                        ) {
                          leaveGroup.mutate(group.id);
                        }
                      }}
                    >
                      <LogOut className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={Boolean(selectedGroup)}
        onOpenChange={(open) => !open && setSelectedGroup(null)}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Automação do grupo: {selectedGroup?.title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-4">
            <div>
              <div className="text-sm font-medium">
                {selectedGroup?.member_count ?? "—"} membros · {messages.length} automações
              </div>
              <div className="text-xs text-muted-foreground">
                O agendador verifica os envios a cada minuto.
              </div>
            </div>
            <Button onClick={openNewMessage} disabled={!selectedGroup?.is_active}>
              <Plus className="mr-2 h-4 w-4" />
              Nova mensagem
            </Button>
          </div>
          {!selectedGroup?.is_active && (
            <p className="text-sm text-destructive">
              O bot não está ativo neste grupo. Adicione-o novamente para habilitar os envios.
            </p>
          )}
          {messagesQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <Card className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Intervalo</TableHead>
                    <TableHead>Último envio</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!messages.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                        Nenhuma mensagem automática neste grupo.
                      </TableCell>
                    </TableRow>
                  )}
                  {messages.map((message) => (
                    <TableRow key={message.id}>
                      <TableCell>
                        <div className="font-medium">{message.title}</div>
                        <div className="max-w-80 truncate text-xs text-muted-foreground">
                          {message.message} · {message.buttons?.length ?? 0} botão(ões)
                        </div>
                      </TableCell>
                      <TableCell>{message.interval_minutes} min</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(message.last_sent_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={message.is_active ? "default" : "secondary"}>
                          {message.is_active ? "Ativa" : "Inativa"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Enviar agora"
                          disabled={sendNow.isPending || !selectedGroup?.is_active}
                          onClick={() => {
                            if (confirm(`Enviar agora para o grupo ${selectedGroup?.title}?`)) {
                              sendNow.mutate(message.id);
                            }
                          }}
                        >
                          <Send className="h-4 w-4 text-primary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditMessage(message)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Excluir esta mensagem automática?")) {
                              removeMessage.mutate(message.id);
                            }
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
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar automação" : "Nova automação do grupo"}</DialogTitle>
          </DialogHeader>
          <form key={editing?.id ?? "new"} className="space-y-4" onSubmit={submitMessage}>
            <div className="space-y-2">
              <Label htmlFor="group-message-title">Título interno</Label>
              <Input
                id="group-message-title"
                name="title"
                required
                defaultValue={editing?.title ?? ""}
                placeholder="Ex: Aviso diário"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-message-text">Mensagem enviada ao grupo</Label>
              <Textarea
                id="group-message-text"
                name="message"
                rows={6}
                defaultValue={editing?.message ?? ""}
                placeholder="Digite uma legenda opcional..."
              />
            </div>
            <div className="space-y-2">
              <Label>Foto ou vídeo opcional</Label>
              <ImageUpload
                value={imageUrl}
                onChange={setImageUrl}
                accept="image/*,video/mp4,video/quicktime,video/webm"
                allowedKinds={["image", "video"]}
                buttonLabel="Enviar foto ou vídeo"
                maxSizeMb={60}
              />
            </div>
            <Card className="space-y-3 border-dashed p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Botões da mensagem</Label>
                  <p className="text-xs text-muted-foreground">
                    Adicione até seis botões abaixo da mensagem.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMessageButton}
                  disabled={messageButtons.length >= 6}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Botão
                </Button>
              </div>
              {!messageButtons.length && (
                <p className="text-xs text-muted-foreground">Nenhum botão configurado.</p>
              )}
              {messageButtons.map((button, index) => (
                <div key={index} className="space-y-2 rounded-xl border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={button.label}
                      maxLength={64}
                      onChange={(event) =>
                        updateMessageButton(index, { label: event.target.value })
                      }
                      placeholder="Texto do botão"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMessageButton(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Select
                    value={button.kind}
                    onValueChange={(value) =>
                      updateMessageButton(index, {
                        kind: value as ButtonKind,
                        url: value === "link" || value === "bot" ? button.url : null,
                        plan_id: value === "plan" ? button.plan_id : null,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(buttonKindLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {button.kind === "link" && (
                    <Input
                      value={button.url ?? ""}
                      onChange={(event) => updateMessageButton(index, { url: event.target.value })}
                      type="url"
                      placeholder="https://..."
                    />
                  )}
                  {button.kind === "bot" && (
                    <div className="space-y-2">
                      <Input
                        value={button.url ?? ""}
                        onChange={(event) =>
                          updateMessageButton(index, { url: event.target.value })
                        }
                        placeholder="@brunabbgg_bot ou https://t.me/brunabbgg_bot"
                      />
                      <p className="text-xs text-muted-foreground">
                        Apenas abre a conversa do bot. Não envia mensagem automática no privado.
                      </p>
                    </div>
                  )}
                  {button.kind === "plan" && (
                    <Select
                      value={button.plan_id ?? ""}
                      onValueChange={(planId) => {
                        const plan = plans.find((item) => item.id === planId);
                        updateMessageButton(index, {
                          plan_id: planId,
                          label: button.label.trim() || plan?.name || "Ver plano",
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
            </Card>
            <div className="space-y-2">
              <Label htmlFor="group-message-interval">Enviar a cada (minutos)</Label>
              <Input
                id="group-message-interval"
                name="interval_minutes"
                type="number"
                min="1"
                max="525600"
                required
                defaultValue={editing?.interval_minutes ?? 60}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="group-message-active"
                name="is_active"
                defaultChecked={editing ? editing.is_active : true}
              />
              <Label htmlFor="group-message-active">Automação ativa</Label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saveMessage.isPending}>
                Salvar automação
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
