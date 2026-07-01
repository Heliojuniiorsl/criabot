import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  Ban,
  Clock3,
  Crown,
  Download,
  Eye,
  Languages,
  MessageSquare,
  Search,
  Send,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";

import { PanelSubnav } from "@/components/PanelSubnav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  exportImageBotUsersCsv,
  getImageBotUserAdminDetails,
  listImageBotPremiumPlans,
  listImageBotUsers,
  sendImageBotUserMessage,
  updateImageBotUserAccess,
  updateImageBotUserPremium,
} from "@/lib/api/admin.functions";

export const Route = createFileRoute("/_authenticated/$bot/usuarios")({
  component: ImageBotUsers,
});

type ImageBotUser = {
  id: string;
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  first_started_at: string;
  last_started_at: string;
  last_activity_at: string;
  media_delivered_count: number;
  favorite_count: number;
  history_count: number;
  is_admin: boolean;
  is_blocked: boolean;
  is_bot: boolean;
  is_telegram_premium: boolean;
  start_count: number;
  telegram_profile_json: string | null;
  selected_category: "hetero" | "trans" | null;
  active_premium_access_count: number;
  active_category_access_count: number;
  active_limit_boost_count: number;
  has_lifetime_premium_access: boolean;
  has_lifetime_limit_boost: boolean;
  premium_until: string | null;
  is_premium: boolean;
  payment_count: number;
  total_paid: number;
};

type ImageBotUserListResult = {
  users: ImageBotUser[];
  total_users: number;
  filtered_users: number;
  active_today: number;
  premium_users: number;
  total_deliveries: number;
  limit: number;
  offset: number;
};

type UserActivity = {
  id: string;
  action:
    | "media_delivered"
    | "media_favorited"
    | "payment_created"
    | "payment_paid"
    | "first_start";
  occurred_at: string;
  category: "hetero" | "trans" | null;
  media_type: "photo" | "video" | null;
  media_id: string | null;
  amount: number | null;
  status: string | null;
  detail: string | null;
};

type UserDetails = {
  user: ImageBotUser;
  history: Array<{
    id: string;
    media_id: string | null;
    category: "hetero" | "trans";
    media_type: "photo" | "video";
    delivery_source: "photo" | "video" | "random" | "favorite";
    delivered_at: string;
  }>;
  favorites: Array<{
    id: string;
    file_id: string;
    category: "hetero" | "trans";
    media_type: "photo" | "video";
    is_active: boolean;
    favorited_at: string;
  }>;
  activity: UserActivity[];
};

type SortMode = "activity" | "deliveries" | "favorites" | "payments";
type PremiumPlan = {
  id: string;
  name: string;
  price: number;
  access_type: "days" | "lifetime";
  access_days: number;
  is_active: boolean;
};
type UserSection = "summary" | "list";

const userSections: { value: UserSection; label: string }[] = [
  { value: "summary", label: "Resumo" },
  { value: "list", label: "Lista de usuários" },
];

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR") : "Não informado";
const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const userName = (user: ImageBotUser) =>
  [user.first_name, user.last_name].filter(Boolean).join(" ") || "Nome não disponível";

function ImageBotUsers() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listImageBotUsers);
  const exportFn = useServerFn(exportImageBotUsersCsv);
  const updateAccessFn = useServerFn(updateImageBotUserAccess);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("activity");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<UserSection>("summary");
  const deferredSearch = useDeferredValue(search.trim());
  const usersQuery = useQuery({
    queryKey: ["image-bot-users", deferredSearch, sort],
    queryFn: () =>
      listFn({
        data: {
          search: deferredSearch,
          sort,
          limit: 100,
          offset: 0,
        },
      }) as Promise<ImageBotUserListResult>,
    refetchInterval: 15_000,
    retry: 1,
  });
  const userResult = usersQuery.data;
  const visibleUsers = userResult?.users ?? [];
  const totalUsers = userResult?.total_users ?? 0;
  const filteredUsers = userResult?.filtered_users ?? totalUsers;
  const activeToday = userResult?.active_today ?? 0;
  const premiumUsers = userResult?.premium_users ?? 0;
  const totalDeliveries = userResult?.total_deliveries ?? 0;

  const access = useMutation({
    mutationFn: (input: { telegram_user_id: number; is_blocked: boolean }) =>
      updateAccessFn({ data: input }),
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ["image-bot-users"] });
      queryClient.invalidateQueries({
        queryKey: ["image-bot-user-details", input.telegram_user_id],
      });
      toast.success(input.is_blocked ? "Usuário bloqueado" : "Usuário desbloqueado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const exportCsv = async () => {
    try {
      const csv = await exportFn();
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `usuários-upmídias-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("CSV exportado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao exportar CSV");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Usuários</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Perfis, atividade, pagamentos, favoritos e comunicacao individual.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <PanelSubnav
        className="mt-6"
        items={userSections}
        active={activeSection}
        onChange={setActiveSection}
      />

      <div
        className={
          activeSection !== "summary"
            ? "panel-section-hidden"
            : "mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        }
      >
        <SummaryCard label="Total de usuários" value={totalUsers} icon={Users} />
        <SummaryCard label="Ativos nas ultimas 24h" value={activeToday} icon={Clock3} />
        <SummaryCard label="Usuários Premium" value={premiumUsers} icon={Crown} />
        <SummaryCard label="Mídias entregues" value={totalDeliveries} icon={Send} />
      </div>

      <Card className={activeSection !== "list" ? "panel-section-hidden" : "mt-6 gap-4 p-4"}>
        <div className="grid gap-3 md:grid-cols-[1fr_230px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, username ou Telegram ID..."
              className="pl-9"
            />
          </div>
          <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="activity">Mais ativos recentemente</SelectItem>
              <SelectItem value="deliveries">Mais mídias recebidas</SelectItem>
              <SelectItem value="favorites">Mais favoritos</SelectItem>
              <SelectItem value="payments">Maior valor pago</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {usersQuery.isFetching && (
          <p className="text-xs text-muted-foreground">Atualizando resultados...</p>
        )}

        <div className="overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Acesso</TableHead>
                <TableHead className="text-center">Mídias</TableHead>
                <TableHead className="text-center">Favoritos</TableHead>
                <TableHead>Pagamentos</TableHead>
                <TableHead>Ultima atividade</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center text-muted-foreground">
                    Carregando usuários...
                  </TableCell>
                </TableRow>
              )}
              {usersQuery.isError && (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center text-destructive">
                    Não consegui carregar os usuários agora.
                  </TableCell>
                </TableRow>
              )}
              {!usersQuery.isLoading && !usersQuery.isError && !visibleUsers.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-14 text-center text-muted-foreground">
                    Nenhum usuário encontrado.
                  </TableCell>
                </TableRow>
              )}
              {visibleUsers.map((user, index) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{userName(user)}</span>
                      {user.is_admin && <Badge>Admin</Badge>}
                      {index < 3 && sort === "deliveries" && (
                        <Trophy className="h-4 w-4 text-amber-500" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {user.username ? `@${user.username}` : "Sem username"} -{" "}
                      {user.telegram_user_id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={user.is_blocked ? "destructive" : "secondary"}>
                        {user.is_blocked ? "Bloqueado" : "Ativo"}
                      </Badge>
                      {user.is_premium && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                          Premium
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center font-medium">
                    {user.media_delivered_count}
                  </TableCell>
                  <TableCell className="text-center font-medium">{user.favorite_count}</TableCell>
                  <TableCell>
                    <div className="font-medium">{formatCurrency(user.total_paid)}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.payment_count} aprovado(s)
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(user.last_activity_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedUserId(user.telegram_user_id)}
                      >
                        <Eye className="h-4 w-4" /> Gerenciar
                      </Button>
                      <Button
                        variant={user.is_blocked ? "outline" : "destructive"}
                        size="sm"
                        disabled={user.is_admin || access.isPending}
                        onClick={() =>
                          access.mutate({
                            telegram_user_id: user.telegram_user_id,
                            is_blocked: !user.is_blocked,
                          })
                        }
                      >
                        {user.is_blocked ? (
                          <UserCheck className="h-4 w-4" />
                        ) : (
                          <Ban className="h-4 w-4" />
                        )}
                        {user.is_blocked ? "Desbloquear" : "Bloquear"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Exibindo {visibleUsers.length} de {filteredUsers} usuário(s)
          {deferredSearch ? " encontrados" : ""}. Total cadastrado: {totalUsers}.
        </p>
      </Card>

      <UserAdminDialog
        telegramUserId={selectedUserId}
        open={selectedUserId !== null}
        onOpenChange={(open) => !open && setSelectedUserId(null)}
      />
    </div>
  );
}

function UserAdminDialog({
  telegramUserId,
  open,
  onOpenChange,
}: {
  telegramUserId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const detailsFn = useServerFn(getImageBotUserAdminDetails);
  const updateAccessFn = useServerFn(updateImageBotUserAccess);
  const listPremiumPlansFn = useServerFn(listImageBotPremiumPlans);
  const updatePremiumFn = useServerFn(updateImageBotUserPremium);
  const sendMessageFn = useServerFn(sendImageBotUserMessage);
  const [message, setMessage] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [preview, setPreview] = useState<{
    mediaId: string;
    type: "photo" | "video";
    fileId: string;
  } | null>(null);
  const { data: details, isLoading } = useQuery({
    queryKey: ["image-bot-user-details", telegramUserId],
    queryFn: () =>
      detailsFn({ data: { telegram_user_id: telegramUserId! } }) as Promise<UserDetails>,
    enabled: telegramUserId !== null && open,
  });
  const { data: premiumPlans = [] } = useQuery({
    queryKey: ["image-bot-premium-plans"],
    queryFn: () => listPremiumPlansFn() as Promise<PremiumPlan[]>,
    enabled: open,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["image-bot-users"] });
    queryClient.invalidateQueries({ queryKey: ["image-bot-user-details", telegramUserId] });
  };
  const access = useMutation({
    mutationFn: (isBlocked: boolean) =>
      updateAccessFn({ data: { telegram_user_id: telegramUserId!, is_blocked: isBlocked } }),
    onSuccess: (_, blockedValue) => {
      refresh();
      toast.success(blockedValue ? "Usuário bloqueado" : "Usuário desbloqueado");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const sendMessage = useMutation({
    mutationFn: () => sendMessageFn({ data: { telegram_user_id: telegramUserId!, message } }),
    onSuccess: () => {
      setMessage("");
      toast.success("Mensagem enviada pelo bot");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const premium = useMutation({
    mutationFn: (input: { action: "grant"; plan_id: string } | { action: "revoke" }) =>
      updatePremiumFn({
        data:
          input.action === "grant"
            ? {
                action: "grant",
                telegram_user_id: telegramUserId!,
                plan_id: input.plan_id,
              }
            : { action: "revoke", telegram_user_id: telegramUserId! },
      }),
    onSuccess: (_, input) => {
      refresh();
      toast.success(input.action === "grant" ? "Premium liberado" : "Premium removido");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {details ? userName(details.user) : "Carregando usuário..."}
              {details?.user.is_premium && (
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                  <Crown className="mr-1 h-3.5 w-3.5" /> Premium
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {details
                ? `Telegram ID ${details.user.telegram_user_id}`
                : "Buscando dados do UpMídias"}
            </DialogDescription>
          </DialogHeader>
          {isLoading || !details ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : (
            <Tabs defaultValue="overview" className="min-h-0">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="overview">Visao geral</TabsTrigger>
                <TabsTrigger value="history">Log ({details.activity.length})</TabsTrigger>
                <TabsTrigger value="favorites">Favoritos ({details.favorites.length})</TabsTrigger>
                <TabsTrigger value="message">Mensagem</TabsTrigger>
              </TabsList>

              <TabsContent value="overview">
                <ScrollArea className="h-[63vh] pr-4">
                  <div className="space-y-4 py-4">
                    <PremiumPanel
                      user={details.user}
                      plans={premiumPlans.filter((plan) => plan.is_active)}
                      selectedPlanId={selectedPlanId}
                      onPlanChange={setSelectedPlanId}
                      pending={premium.isPending}
                      onGrant={() => {
                        if (!selectedPlanId) {
                          toast.error("Escolha um plano Premium");
                          return;
                        }
                        premium.mutate({ action: "grant", plan_id: selectedPlanId });
                      }}
                      onRevoke={() => {
                        if (
                          window.confirm(
                            "Remover todo o Premium deste usuário, inclusive acessos pagos e pacotes ativos?",
                          )
                        ) {
                          premium.mutate({ action: "revoke" });
                        }
                      }}
                    />
                    <div className="overflow-hidden rounded-2xl border bg-white">
                      <CompactInfoRow label="Nome completo" value={userName(details.user)} />
                      <CompactInfoRow
                        label="Username"
                        value={
                          details.user.username ? `@${details.user.username}` : "Não informado"
                        }
                      />
                      <CompactInfoRow
                        label="Telegram ID"
                        value={String(details.user.telegram_user_id)}
                      />
                      <CompactInfoRow
                        label="Idioma"
                        value={details.user.language_code || "Não informado"}
                        icon={Languages}
                      />
                      <CompactInfoRow
                        label="Premium do Telegram"
                        value={details.user.is_telegram_premium ? "Sim" : "Não informado"}
                      />
                      <CompactInfoRow
                        label="Primeiro /start"
                        value={formatDate(details.user.first_started_at)}
                      />
                      <CompactInfoRow
                        label="Ultimo /start"
                        value={formatDate(details.user.last_started_at)}
                      />
                      <CompactInfoRow
                        label="Quantidade de /start"
                        value={String(details.user.start_count)}
                      />
                      <CompactInfoRow
                        label="Ultima atividade"
                        value={formatDate(details.user.last_activity_at)}
                        icon={Activity}
                      />
                      <CompactInfoRow
                        label="Menu atual"
                        value={
                          details.user.selected_category
                            ? categoryLabel(details.user.selected_category)
                            : "Menu inicial"
                        }
                      />
                      <CompactInfoRow
                        label="Mídias recebidas"
                        value={String(details.user.media_delivered_count)}
                      />
                      <CompactInfoRow
                        label="Favoritos"
                        value={String(details.user.favorite_count)}
                      />
                    </div>

                    <TelegramProfileData user={details.user} />

                    <Card className="p-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <h3 className="font-semibold">Acesso ao bot</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {details.user.is_blocked
                              ? "Este usuário esta bloqueado."
                              : "Este usuário pode utilizar o bot."}
                          </p>
                        </div>
                        <Button
                          variant={details.user.is_blocked ? "outline" : "destructive"}
                          disabled={details.user.is_admin || access.isPending}
                          onClick={() => access.mutate(!details.user.is_blocked)}
                        >
                          {details.user.is_blocked ? (
                            <UserCheck className="h-4 w-4" />
                          ) : (
                            <Ban className="h-4 w-4" />
                          )}
                          {details.user.is_blocked ? "Desbloquear" : "Bloquear usuário"}
                        </Button>
                      </div>
                      {details.user.is_admin && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Administradores não podem ser bloqueados.
                        </p>
                      )}
                    </Card>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="history">
                <ScrollArea className="h-[63vh] pr-4">
                  <div className="py-4">
                    {!details.activity.length ? (
                      <EmptyState text="Nenhuma atividade registrada para este usuário." />
                    ) : (
                      <div className="overflow-hidden rounded-2xl border bg-white">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-44">Data</TableHead>
                              <TableHead>Ação</TableHead>
                              <TableHead>Categoria</TableHead>
                              <TableHead>Tipo/detalhe</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {details.activity.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                                  {formatDate(item.occurred_at)}
                                </TableCell>
                                <TableCell className="py-2 font-medium">
                                  {activityLabel(item)}
                                </TableCell>
                                <TableCell className="py-2">
                                  {item.category ? categoryLabel(item.category) : "-"}
                                </TableCell>
                                <TableCell className="py-2 text-sm text-muted-foreground">
                                  {activityDetail(item)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="favorites">
                <ScrollArea className="h-[63vh] pr-4">
                  <div className="py-4">
                    {!details.favorites.length ? (
                      <EmptyState text="Este usuário ainda não possui favoritos." />
                    ) : (
                      <div className="overflow-x-auto rounded-2xl border bg-white">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>File ID</TableHead>
                              <TableHead>Categoria</TableHead>
                              <TableHead>Tipo</TableHead>
                              <TableHead>Favoritada em</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Ação</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {details.favorites.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="max-w-72 py-2">
                                  <code className="block truncate text-xs" title={item.file_id}>
                                    {item.file_id}
                                  </code>
                                </TableCell>
                                <TableCell className="py-2">
                                  {categoryLabel(item.category)}
                                </TableCell>
                                <TableCell className="py-2">
                                  {item.media_type === "photo" ? "Foto" : "Vídeo"}
                                </TableCell>
                                <TableCell className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                                  {formatDate(item.favorited_at)}
                                </TableCell>
                                <TableCell className="py-2">
                                  <Badge variant={item.is_active ? "secondary" : "destructive"}>
                                    {item.is_active ? "Ativa" : "Desativada"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="py-2 text-right">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setPreview({
                                        mediaId: item.id,
                                        type: item.media_type,
                                        fileId: item.file_id,
                                      })
                                    }
                                  >
                                    <Eye className="h-4 w-4" /> Ver mídia
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="message">
                <div className="py-5">
                  <Card className="p-5">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      <h3 className="font-semibold">Mensagem individual</h3>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      A mensagem será enviada diretamente pelo bot UpMídias.
                    </p>
                    <Textarea
                      className="mt-4 min-h-44"
                      maxLength={4000}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Digite a mensagem..."
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">{message.length}/4000</span>
                      <Button
                        disabled={!message.trim() || sendMessage.isPending}
                        onClick={() => sendMessage.mutate()}
                      >
                        <Send className="h-4 w-4" /> Enviar mensagem
                      </Button>
                    </div>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={(next) => !next && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Visualizar mídia favorita</DialogTitle>
            <DialogDescription className="break-all">{preview?.fileId}</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="grid max-h-[70vh] place-items-center overflow-hidden rounded-2xl bg-black">
              {preview.type === "photo" ? (
                <img
                  src={`/api/admin/image-bot-media/${preview.mediaId}`}
                  alt="Midia favorita"
                  className="max-h-[70vh] max-w-full object-contain"
                />
              ) : (
                <video
                  src={`/api/admin/image-bot-media/${preview.mediaId}`}
                  className="max-h-[70vh] max-w-full"
                  controls
                  autoPlay
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PremiumPanel({
  user,
  plans,
  selectedPlanId,
  onPlanChange,
  pending,
  onGrant,
  onRevoke,
}: {
  user: ImageBotUser;
  plans: PremiumPlan[];
  selectedPlanId: string;
  onPlanChange: (value: string) => void;
  pending: boolean;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  const validity =
    user.has_lifetime_premium_access || user.has_lifetime_limit_boost
      ? "Vitalício"
      : user.premium_until
        ? `Ate ${formatDate(user.premium_until)}`
        : "Nenhum benefício ativo";
  return (
    <div
      className={
        user.is_premium
          ? "rounded-2xl border border-amber-200 bg-amber-50 p-4"
          : "rounded-2xl border bg-muted/40 p-4"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Crown
            className={user.is_premium ? "h-6 w-6 text-amber-600" : "h-6 w-6 text-muted-foreground"}
          />
          <div>
            <div className="font-semibold">
              {user.is_premium ? "Usuário Premium" : "Usuário gratuito"}
            </div>
            <div className="text-sm text-muted-foreground">{validity}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-semibold">{formatCurrency(user.total_paid)}</div>
          <div className="text-xs text-muted-foreground">
            {user.payment_count} pagamento(s) aprovado(s)
          </div>
        </div>
      </div>
      {user.is_premium && (
        <div className="mt-3 flex flex-wrap gap-2">
          {user.active_premium_access_count > 0 && (
            <Badge variant="secondary">Premium global ativo</Badge>
          )}
          {user.active_category_access_count > 0 && (
            <Badge variant="secondary">
              {user.active_category_access_count} categoria(s) liberada(s)
            </Badge>
          )}
          {user.active_limit_boost_count > 0 && (
            <Badge variant="secondary">{user.active_limit_boost_count} pacote(s) de limite</Badge>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-sm font-medium">Plano para liberar manualmente</label>
          <Select value={selectedPlanId} onValueChange={onPlanChange}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha um plano Premium" />
            </SelectTrigger>
            <SelectContent>
              {plans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.name} - {formatCurrency(plan.price)} -{" "}
                  {plan.access_type === "lifetime" ? "Vitalício" : `${plan.access_days} dias`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={!plans.length || pending} onClick={onGrant}>
          <Crown className="h-4 w-4" /> Liberar Premium
        </Button>
        <Button variant="destructive" disabled={!user.is_premium || pending} onClick={onRevoke}>
          Remover Premium
        </Button>
      </div>
      {!plans.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          Crie um plano na aba Planos Premium para liberar manualmente.
        </p>
      )}
    </div>
  );
}

function TelegramProfileData({ user }: { user: ImageBotUser }) {
  const entries = useMemo(() => {
    if (!user.telegram_profile_json) return [];
    try {
      const parsed = JSON.parse(user.telegram_profile_json) as Record<string, unknown>;
      return Object.entries(parsed).filter(([, value]) => value !== null && value !== undefined);
    } catch {
      return [];
    }
  }, [user.telegram_profile_json]);
  if (!entries.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border bg-white">
      <div className="border-b px-4 py-3 font-semibold">Dados recebidos do Telegram</div>
      {entries.map(([key, value]) => (
        <CompactInfoRow
          key={key}
          label={key}
          value={typeof value === "object" ? JSON.stringify(value) : String(value)}
        />
      ))}
    </div>
  );
}

function CompactInfoRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Users;
}) {
  return (
    <div className="grid gap-1 border-b px-4 py-2.5 last:border-b-0 sm:grid-cols-[210px_1fr]">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
        {label}
      </div>
      <div className="break-all text-sm font-medium">{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function categoryLabel(category: "hetero" | "trans") {
  return category === "hetero" ? "Hetero" : "Trans";
}

function activityLabel(item: UserActivity) {
  if (item.action === "first_start") return "Primeiro /start";
  if (item.action === "media_favorited") return "Favoritou uma mídia";
  if (item.action === "payment_paid") return "Pagamento aprovado";
  if (item.action === "payment_created") return "Pix gerado";
  return "Midia recebida";
}

function activityDetail(item: UserActivity) {
  if (item.action === "payment_paid" || item.action === "payment_created") {
    const product = item.detail === "limit_upgrade" ? "Mais limite" : "Acesso a categoria";
    return `${product} - ${formatCurrency(Number(item.amount ?? 0))} - ${item.status ?? ""}`;
  }
  if (item.action === "media_favorited") {
    return `${item.media_type === "photo" ? "Foto" : "Vídeo"} - ${item.detail ?? ""}`;
  }
  if (item.action === "media_delivered") {
    const source =
      item.detail === "favorite"
        ? "Favorito"
        : item.detail === "random"
          ? "Aleatorio"
          : item.detail === "video"
            ? "Vídeo"
            : "Foto";
    return `${item.media_type === "photo" ? "Foto" : "Vídeo"} - ${source}`;
  }
  return "Usuário iniciou o bot";
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Users;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="mt-4 font-display text-3xl font-semibold">{value}</div>
    </Card>
  );
}
