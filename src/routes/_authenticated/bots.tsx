import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Crown,
  ExternalLink,
  Images,
  Loader2,
  LogOut,
  MessageSquareText,
  Play,
  Plus,
  RotateCw,
  ShieldCheck,
  Square,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createManagedSalesBot,
  getCriaBotLinkStatus,
  getManagedBots,
  runManagedBotAction,
  validateManagedSalesBotToken,
  verifyManagedSalesBotVipChat,
} from "@/lib/api/admin.functions";
import { getAdminSession, logoutAdminAccount } from "@/lib/api/auth.functions";

export const Route = createFileRoute("/_authenticated/bots")({
  component: LegacyBotsRoute,
});

type ManagedBot = {
  key: string;
  kind: "sales" | "images";
  is_custom: boolean;
  display_name: string;
  panel_path: string | null;
  configured: boolean;
  telegram_name: string | null;
  username: string | null;
  photo_data_url: string | null;
  webhook_url: string | null;
  pending_updates: number;
  status: "online" | "stopped" | "error" | "not_configured";
  status_message: string | null;
};

type ValidatedTelegramBot = {
  token: string;
  telegram_id: string;
  username: string;
  display_name: string;
  photo_data_url: string | null;
};

type TokenValidationResult = {
  ok: true;
  bot: Omit<ValidatedTelegramBot, "token">;
};

type TelegramChatType = "group" | "supergroup" | "channel" | "private" | null;

type VipVerificationResult = {
  ok: boolean;
  chat_id: number;
  chat: {
    id: number;
    title: string;
    username: string | null;
    type: TelegramChatType;
  } | null;
  bot_status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" | null;
  bot_in_chat: boolean;
  is_admin: boolean;
  member_count: number | null;
  message: string | null;
};

type CriaBotLinkedUser = {
  telegram_user_id: number;
  telegram_chat_id: number;
  is_bot: boolean;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  language_code: string | null;
  is_premium: boolean;
  photo_data_url: string | null;
  linked_at: string;
  updated_at: string;
};

type CriaBotLinkStatus = {
  configured: boolean;
  error: string | null;
  bot: {
    id: string;
    username: string;
    display_name: string;
    photo_data_url: string | null;
  } | null;
  link_url: string | null;
  expires_at: string | null;
  linked_user: CriaBotLinkedUser | null;
};

type PlanAccessType = "days" | "lifetime";

type CreateManagedBotInput = {
  token: string;
  vip_chat_id: number;
  welcome_message: string;
  plan_name: string;
  plan_button_label: string | null;
  plan_detail_message: string;
  plan_price: number;
  plan_access_type: PlanAccessType;
  plan_duration_days: number;
};

const telegramBotTokenPattern = /^\d{6,14}:[A-Za-z0-9_-]{30,}$/;

function formatTelegramChatType(type: TelegramChatType) {
  if (type === "channel") return "Canal";
  if (type === "supergroup") return "Supergrupo";
  if (type === "group") return "Grupo";
  if (type === "private") return "Privado";
  return "Grupo/canal";
}

function formatBotChatStatus(status: VipVerificationResult["bot_status"]) {
  if (status === "creator") return "Criador";
  if (status === "administrator") return "Administrador";
  if (status === "member") return "Membro";
  if (status === "restricted") return "Restrito";
  if (status === "left") return "Fora";
  if (status === "kicked") return "Removido";
  return "Nao encontrado";
}

const wizardSteps = [
  {
    id: 1,
    title: "Telegram",
    description: "Conectar token",
    icon: ShieldCheck,
  },
  {
    id: 2,
    title: "VIP",
    description: "Grupo ou canal",
    icon: Users,
  },
  {
    id: 3,
    title: "Primeiro plano",
    description: "Mensagem e preco",
    icon: Crown,
  },
  {
    id: 4,
    title: "Revisao",
    description: "Criar bot",
    icon: CheckCircle2,
  },
] as const;

function parseMoneyInput(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  return Number(normalized);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatCriaBotUserName(user: CriaBotLinkedUser) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (user.username) return `@${user.username}`;
  return `ID ${user.telegram_user_id}`;
}

function MiniTutorial({
  title,
  items,
}: {
  title: string;
  items: Array<{ title: string; body: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-[#F5F5F3] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <ShieldCheck className="h-4 w-4" />
        {title}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {items.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
            className="rounded-2xl bg-background p-3 text-sm shadow-sm"
          >
            <p className="font-semibold">
              {index + 1}. {item.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const botFatherTokenTutorial = [
  "Abra o Telegram e pesquise por @BotFather.",
  "Depois de encontrar o BotFather, toque em Open no botao que aparece embaixo, proximo a caixa de mensagem.",
  "Se for a primeira vez, toque em Start.",
  "Toque em Create a New Bot.",
  "Digite o nome do bot.",
  "Escolha um username unico terminado em bot ou _bot. Ex: usernamebot ou username_bot.",
  "Quando o bot for criado, o BotFather mostrara o token da API.",
  "Toque em Copy para copiar o token.",
];

const botFatherUrl = "https://t.me/BotFather";

function BotFatherTutorialText({ text }: { text: string }) {
  if (!text.includes("BotFather")) return <>{text}</>;

  const [before, after] = text.split("BotFather");
  return (
    <>
      {before}
      <a
        href={botFatherUrl}
        target="_blank"
        rel="noreferrer"
        className="font-semibold text-primary hover:text-primary/80"
      >
        BotFather
      </a>
      {after}
    </>
  );
}

function BotFatherTokenTutorialAside() {
  return (
    <aside className="border-t pt-4 lg:sticky lg:top-24 lg:self-start lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Como pegar o token
        </div>
        <Button asChild variant="outline" size="sm" className="h-8 rounded-full px-3 text-xs">
          <a href={botFatherUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Abrir BotFather
          </a>
        </Button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Siga estes passos no Telegram antes de colar o token no CriaBot.
      </p>
      <ol className="mt-3 space-y-0 divide-y">
        {botFatherTokenTutorial.map((item, index) => (
          <li key={item} className="flex gap-2.5 py-2 text-xs first:pt-0 last:pb-0">
            <span className="w-6 shrink-0 font-semibold text-primary">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="leading-relaxed text-muted-foreground">
              <BotFatherTutorialText text={item} />
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

const statusLabels: Record<ManagedBot["status"], string> = {
  online: "Online",
  stopped: "Parado",
  error: "Erro",
  not_configured: "Não configurado",
};

const statusClasses: Record<ManagedBot["status"], string> = {
  online: "bg-emerald-100 text-emerald-700",
  stopped: "bg-slate-200 text-slate-700",
  error: "bg-red-100 text-red-700",
  not_configured: "bg-amber-100 text-amber-700",
};

function LegacyBotsRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: "/painel/bots", replace: true });
  }, [navigate]);

  return (
    <div className="p-8 text-sm text-muted-foreground">Redirecionando para o painel de bots...</div>
  );
}

type BotsPanelContentProps = {
  embedded?: boolean;
  mode?: "list" | "create";
};

export function BotsPanelContent({ embedded = false, mode = "list" }: BotsPanelContentProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isCreateMode = mode === "create";
  const logoutFn = useServerFn(logoutAdminAccount);
  const sessionFn = useServerFn(getAdminSession);
  const listFn = useServerFn(getManagedBots);
  const actionFn = useServerFn(runManagedBotAction);
  const createBotFn = useServerFn(createManagedSalesBot);
  const validateTokenFn = useServerFn(validateManagedSalesBotToken);
  const verifyVipChatFn = useServerFn(verifyManagedSalesBotVipChat);
  const criaBotLinkStatusFn = useServerFn(getCriaBotLinkStatus);
  const lastAutoValidatedTokenRef = useRef("");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [token, setToken] = useState("");
  const [validatedBot, setValidatedBot] = useState<ValidatedTelegramBot | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [vipChatId, setVipChatId] = useState("");
  const [vipVerification, setVipVerification] = useState<VipVerificationResult | null>(null);
  const [vipVerificationError, setVipVerificationError] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState(
    "Bem-vindo(a)! Escolha um plano abaixo para liberar seu acesso VIP.",
  );
  const [planName, setPlanName] = useState("VIP 30 dias");
  const [planButtonLabel, setPlanButtonLabel] = useState("");
  const [planDetailMessage, setPlanDetailMessage] = useState(
    "{{nome}}\n\nAcesso: {{validade}}\nValor: {{preco}}\n\nToque em comprar para gerar seu Pix.",
  );
  const [planPrice, setPlanPrice] = useState("29,90");
  const [planAccessType, setPlanAccessType] = useState<PlanAccessType>("days");
  const [planDurationDays, setPlanDurationDays] = useState("30");

  const sessionQuery = useQuery({
    queryKey: ["admin-session"],
    queryFn: () => sessionFn(),
  });

  const botsQuery = useQuery({
    queryKey: ["managed-bots"],
    queryFn: () =>
      withTimeout(
        listFn() as Promise<ManagedBot[]>,
        15_000,
        "A consulta ao Telegram demorou demais. Tente novamente em alguns segundos.",
      ),
    refetchInterval: 15_000,
    retry: 1,
  });

  const criaBotLinkQuery = useQuery({
    queryKey: ["criabot-link-status"],
    queryFn: () => criaBotLinkStatusFn() as Promise<CriaBotLinkStatus>,
    enabled: isCreateMode && step === 1,
    refetchInterval: isCreateMode && step === 1 ? 4_000 : false,
    retry: 1,
  });

  const createBot = useMutation({
    mutationFn: (data: CreateManagedBotInput) => createBotFn({ data }),
    onSuccess: async (result) => {
      setToken("");
      setValidatedBot(null);
      setValidationError(null);
      setVipChatId("");
      setStep(1);
      await qc.invalidateQueries({ queryKey: ["managed-bots"] });
      toast.success(`Bot @${result.bot.username} cadastrado`);
      await navigate({ to: "/painel/bots" });
    },
    onError: (error: any) => toast.error(error.message),
  });

  const validateToken = useMutation({
    mutationFn: (data: { token: string }) =>
      validateTokenFn({ data }) as Promise<TokenValidationResult>,
    onSuccess: (result, variables) => {
      setValidationError(null);
      setValidatedBot({
        ...result.bot,
        token: variables.token.trim(),
      });
      toast.success(`Token validado: @${result.bot.username}`);
    },
    onError: (error: any) => {
      const message = error?.message || "Não consegui consultar esse token no Telegram.";
      setValidatedBot(null);
      setValidationError(message);
      toast.error(message);
    },
  });

  const verifyVipChat = useMutation({
    mutationFn: (data: { token: string; vip_chat_id: number }) =>
      verifyVipChatFn({ data }) as Promise<VipVerificationResult>,
    onSuccess: (result) => {
      setVipVerification(result);
      setVipVerificationError(result.ok ? null : result.message);
      if (result.ok) {
        toast.success("Grupo/canal VIP verificado");
      } else {
        toast.error(result.message || "O bot ainda nao esta pronto nesse grupo/canal.");
      }
    },
    onError: (error: any) => {
      const message = error?.message || "Nao consegui verificar esse grupo/canal VIP.";
      setVipVerification(null);
      setVipVerificationError(message);
      toast.error(message);
    },
  });

  const action = useMutation({
    mutationFn: (data: { key: ManagedBot["key"]; action: "start" | "stop" | "restart" }) =>
      actionFn({ data }) as Promise<{ status_message?: string | null }>,
    onSuccess: async (result, variables) => {
      await qc.invalidateQueries({ queryKey: ["managed-bots"] });
      const messages = {
        start: "Bot iniciado",
        stop: "Bot parado",
        restart: "Bot reiniciado",
      };
      toast.success(result.status_message || messages[variables.action]);
    },
    onError: (error: any) => toast.error(error.message),
  });

  async function signOut() {
    await logoutFn();
    await navigate({ to: "/" });
  }

  const bots = botsQuery.data ?? [];
  const onlineBotsCount = bots.filter((bot) => bot.status === "online").length;
  const errorBotsCount = bots.filter((bot) => bot.status === "error").length;
  const pendingUpdatesCount = bots.reduce((total, bot) => total + bot.pending_updates, 0);
  const role = sessionQuery.data?.admin?.role ?? "creator";
  const isAdmin = role === "admin";
  const criaBotLinkStatus = criaBotLinkQuery.data;
  const linkedCriaBotUser = criaBotLinkStatus?.linked_user ?? null;
  const cleanToken = token.trim();
  const hasToken = cleanToken.length > 0;
  const tokenHasValidFormat = !hasToken || telegramBotTokenPattern.test(cleanToken);
  const validatedTokenIsCurrent = Boolean(validatedBot && validatedBot.token === cleanToken);
  const vipChatIdNumber = Number(vipChatId.trim());
  const vipChatIdIsValid =
    /^-?\d+$/.test(vipChatId.trim()) && Number.isInteger(vipChatIdNumber) && vipChatIdNumber < 0;
  const vipPreviewIsCurrent =
    Boolean(vipVerification) && vipVerification?.chat_id === vipChatIdNumber;
  const vipVerificationIsCurrent = vipPreviewIsCurrent && Boolean(vipVerification?.ok);
  const planPriceNumber = parseMoneyInput(planPrice);
  const planPriceIsValid = Number.isFinite(planPriceNumber) && planPriceNumber >= 0;
  const planDurationNumber = Number(planDurationDays);
  const planDurationIsValid =
    planAccessType === "lifetime" ||
    (Number.isInteger(planDurationNumber) && planDurationNumber >= 1 && planDurationNumber <= 3650);
  const planStepIsValid =
    planName.trim().length > 0 &&
    welcomeMessage.trim().length > 0 &&
    planDetailMessage.trim().length > 0 &&
    planPriceIsValid &&
    planDurationIsValid;
  const canCreateBot =
    validatedTokenIsCurrent && vipChatIdIsValid && vipVerificationIsCurrent && planStepIsValid;

  function handleTokenChange(value: string) {
    setToken(value);
    setValidatedBot(null);
    setValidationError(null);
    setVipVerification(null);
    setVipVerificationError(null);
    lastAutoValidatedTokenRef.current = "";
  }

  function handleValidateToken() {
    if (!cleanToken) {
      setValidationError("Cole o token do bot antes de validar.");
      return;
    }
    if (!telegramBotTokenPattern.test(cleanToken)) {
      setValidationError("Formato inválido. Use o token completo do BotFather: numeros:chave.");
      return;
    }
    validateToken.mutate({ token: cleanToken });
  }

  function handleVipChatIdChange(value: string) {
    setVipChatId(value);
    setVipVerification(null);
    setVipVerificationError(null);
  }

  function handleVerifyVipChat() {
    if (!validatedTokenIsCurrent) {
      toast.error("Valide o token do bot antes de verificar o VIP.");
      setStep(1);
      return;
    }
    if (!vipChatIdIsValid) {
      setVipVerificationError("Informe um ID negativo valido antes de verificar.");
      return;
    }
    verifyVipChat.mutate({ token: cleanToken, vip_chat_id: vipChatIdNumber });
  }

  function handleCreateBot() {
    if (!validatedTokenIsCurrent) {
      toast.error("Valide o token no Telegram antes de criar o bot.");
      return;
    }
    if (!vipChatIdIsValid) {
      toast.error("Informe o ID negativo do grupo ou canal VIP.");
      setStep(2);
      return;
    }
    if (!vipVerificationIsCurrent) {
      toast.error("Verifique o grupo/canal VIP antes de criar o bot.");
      setStep(2);
      return;
    }
    if (!planStepIsValid) {
      toast.error("Complete a mensagem e o primeiro plano.");
      setStep(3);
      return;
    }
    createBot.mutate({
      token: cleanToken,
      vip_chat_id: vipChatIdNumber,
      welcome_message: welcomeMessage.trim(),
      plan_name: planName.trim(),
      plan_button_label: planButtonLabel.trim() || null,
      plan_detail_message: planDetailMessage.trim(),
      plan_price: planPriceNumber,
      plan_access_type: planAccessType,
      plan_duration_days: planAccessType === "lifetime" ? 1 : planDurationNumber,
    });
  }

  function goNext() {
    if (step === 1 && !validatedTokenIsCurrent) {
      toast.error("Valide o token antes de continuar.");
      return;
    }
    if (step === 2 && (!vipChatIdIsValid || !vipVerificationIsCurrent)) {
      toast.error(
        !vipChatIdIsValid
          ? "Informe um ID negativo de grupo ou canal, por exemplo -1001234567890."
          : "Clique em verificar e confirme que o bot e administrador do VIP.",
      );
      return;
    }
    if (step === 3 && !planStepIsValid) {
      toast.error("Complete o nome, mensagem, preco e validade do plano.");
      return;
    }
    setStep((current) => Math.min(4, current + 1) as 1 | 2 | 3 | 4);
  }

  function goBack() {
    setStep((current) => Math.max(1, current - 1) as 1 | 2 | 3 | 4);
  }

  type WizardStepId = (typeof wizardSteps)[number]["id"];

  function getStepBlockMessage(targetStep: WizardStepId) {
    if (targetStep >= 2 && !validatedTokenIsCurrent) {
      return "Valide o token do Telegram antes de continuar.";
    }
    if (targetStep >= 3 && (!vipChatIdIsValid || !vipVerificationIsCurrent)) {
      return "Verifique o grupo ou canal VIP antes de continuar.";
    }
    if (targetStep >= 4 && !planStepIsValid) {
      return "Complete a primeira mensagem e o plano antes de revisar.";
    }
    return null;
  }

  function handleStepSelect(targetStep: WizardStepId) {
    const blockMessage = getStepBlockMessage(targetStep);
    if (blockMessage) {
      toast.error(blockMessage);
      return;
    }
    setStep(targetStep);
  }

  useEffect(() => {
    if (!isCreateMode || step !== 1) {
      return;
    }
    if (!cleanToken || !telegramBotTokenPattern.test(cleanToken) || validatedTokenIsCurrent) {
      return;
    }
    if (validateToken.isPending || lastAutoValidatedTokenRef.current === cleanToken) {
      return;
    }

    const timeout = setTimeout(() => {
      lastAutoValidatedTokenRef.current = cleanToken;
      validateToken.mutate({ token: cleanToken });
    }, 600);

    return () => clearTimeout(timeout);
  }, [cleanToken, isCreateMode, step, validatedTokenIsCurrent, validateToken]);

  return (
    <main
      className={
        embedded
          ? `relative overflow-hidden border-0 ${isCreateMode ? "lg:-mt-14" : ""}`
          : "relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_15%_0%,rgba(37,99,235,.08),transparent_28rem),linear-gradient(180deg,#ffffff_0%,#f5f5f3_100%)] px-4 py-6 sm:px-5 sm:py-12"
      }
    >
      {!embedded && (
        <div className="pointer-events-none absolute right-[-12rem] top-[-12rem] h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      )}
      <div
        className={
          embedded
            ? `relative mx-auto w-full ${isCreateMode ? "max-w-7xl" : "max-w-6xl"}`
            : "relative mx-auto flex w-full max-w-6xl flex-col justify-start md:min-h-[calc(100vh-6rem)] md:justify-center"
        }
      >
        {!(isCreateMode && embedded) && (
          <section className="rounded-[2rem] border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                {!embedded && <BrandMark subtitle="Painel da plataforma" />}
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                  {isCreateMode ? "Novo bot" : "Gerenciamento"}
                </p>
                <h1
                  className={`font-display text-3xl font-semibold leading-tight sm:text-4xl ${
                    embedded ? "mt-2" : "mt-6 sm:mt-8"
                  }`}
                >
                  {embedded
                    ? isCreateMode
                      ? "Criar bot"
                      : "Bots"
                    : "Escolha qual bot deseja gerenciar"}
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                  {isCreateMode
                    ? "Conecte o Telegram, configure o VIP e publique o primeiro plano."
                    : isAdmin
                      ? "Acompanhe os bots conectados, status de webhook e ações principais."
                      : "Cadastre bots do Telegram com painel e banco próprios para cada projeto."}
                </p>
              </div>
              {(!isCreateMode || !embedded) && (
                <div className="flex flex-wrap gap-2 self-start sm:self-auto">
                  {!isCreateMode && (
                    <Button asChild className="rounded-full px-5">
                      <Link to="/painel/bots/novo-bot">
                        <Plus className="mr-2 h-4 w-4" />
                        Criar bot
                      </Link>
                    </Button>
                  )}
                  {!embedded && (
                    <Button variant="ghost" className="rounded-full" onClick={signOut}>
                      <LogOut className="mr-2 h-4 w-4" /> Sair
                    </Button>
                  )}
                </div>
              )}
            </div>

            {!isCreateMode && (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="mt-1 font-display text-2xl font-semibold">{bots.length}</p>
                </div>
                <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Online</p>
                  <p className="mt-1 font-display text-2xl font-semibold text-emerald-700">
                    {onlineBotsCount}
                  </p>
                </div>
                <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Pendências</p>
                  <p className="mt-1 font-display text-2xl font-semibold">
                    {errorBotsCount + pendingUpdatesCount}
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {isCreateMode && (
          <section className={`${embedded ? "mt-6" : "mt-8"}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="mt-3 font-display text-2xl font-semibold">
                  Crie um bot pronto para vender
                </h2>
              </div>
              <div className="text-sm text-muted-foreground">Passo {step} de 4</div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-4">
              {wizardSteps.map((item) => {
                const Icon = item.icon;
                const active = item.id === step;
                const done = item.id < step;
                const blocked = Boolean(getStepBlockMessage(item.id));
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleStepSelect(item.id)}
                    aria-disabled={blocked}
                    className={`rounded-2xl border px-3 py-2 text-left transition ${
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : done
                          ? "border-primary/20 bg-primary/5 text-primary"
                          : "border-border bg-card/70 text-muted-foreground hover:bg-muted/60"
                    } ${blocked ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          active
                            ? "bg-white/20"
                            : done
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide">
                          Passo {item.id}
                        </span>
                        <span
                          className={`block truncate text-sm font-semibold ${
                            active ? "text-primary-foreground" : "text-foreground"
                          }`}
                        >
                          {item.title}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div
              className={`mt-5 grid gap-5 ${
                step === 1
                  ? "lg:grid-cols-[minmax(0,1fr)_minmax(260px,330px)]"
                  : step === 4
                    ? "lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]"
                    : ""
              }`}
            >
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (step === 4) {
                    handleCreateBot();
                  } else {
                    goNext();
                  }
                }}
              >
                {step === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-display text-xl font-semibold">
                        Passo 1: conectar Telegram
                      </h3>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="telegram_token">Token do bot</Label>
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                          <Input
                            id="telegram_token"
                            value={token}
                            onChange={(event) => handleTokenChange(event.target.value)}
                            placeholder="1234567890:ABC..."
                            type="password"
                            autoComplete="off"
                            required
                            className={
                              !tokenHasValidFormat || validationError
                                ? "border-destructive"
                                : undefined
                            }
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleValidateToken}
                            disabled={!hasToken || !tokenHasValidFormat || validateToken.isPending}
                            className="rounded-full lg:h-11"
                          >
                            {validateToken.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <ShieldCheck className="mr-2 h-4 w-4" />
                            )}
                            {validateToken.isPending ? "Validando..." : "Validar token"}
                          </Button>
                          <Button asChild variant="outline" className="rounded-full lg:h-11">
                            <a href={botFatherUrl} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Abrir BotFather
                            </a>
                          </Button>
                        </div>
                        {!tokenHasValidFormat && (
                          <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Token em formato invalido.
                          </p>
                        )}
                        {validationError && (
                          <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {validationError}
                          </p>
                        )}
                      </div>
                      {validateToken.isPending && hasToken && tokenHasValidFormat && (
                        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
                          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                          Validando token automaticamente...
                        </div>
                      )}
                      {validatedTokenIsCurrent && validatedBot && (
                        <div className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                          {validatedBot.photo_data_url ? (
                            <img
                              src={validatedBot.photo_data_url}
                              alt={`Foto de ${validatedBot.display_name}`}
                              className="h-16 w-16 rounded-2xl object-cover"
                            />
                          ) : (
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                              <Bot className="h-8 w-8" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                              <CheckCircle2 className="h-4 w-4" />
                              Token validado
                            </div>
                            <p className="mt-1 truncate font-display text-xl font-semibold">
                              {validatedBot.display_name}
                            </p>
                            <p className="truncate text-sm text-muted-foreground">
                              @{validatedBot.username}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="border-t pt-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                            <UserRound className="h-4 w-4" />
                            Vincular usuario ao CriaBot
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Abra o bot oficial, toque em /start e o site mostra aqui os dados do
                            Telegram vinculados a esta conta.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {criaBotLinkStatus?.link_url && (
                            <Button asChild className="rounded-full px-4">
                              <a href={criaBotLinkStatus.link_url} target="_blank" rel="noreferrer">
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Abrir bot oficial
                              </a>
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => void criaBotLinkQuery.refetch()}
                            disabled={criaBotLinkQuery.isFetching}
                          >
                            {criaBotLinkQuery.isFetching ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCw className="mr-2 h-4 w-4" />
                            )}
                            Atualizar
                          </Button>
                        </div>
                      </div>

                      {criaBotLinkQuery.isLoading && (
                        <div className="mt-4 rounded-2xl bg-background p-4 text-sm text-muted-foreground">
                          <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-primary" />
                          Consultando bot oficial...
                        </div>
                      )}

                      {criaBotLinkStatus?.error && (
                        <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                          {criaBotLinkStatus.error}
                        </div>
                      )}

                      {criaBotLinkStatus?.bot && (
                        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-muted/40 p-3 text-sm">
                          {criaBotLinkStatus.bot.photo_data_url ? (
                            <img
                              src={criaBotLinkStatus.bot.photo_data_url}
                              alt={`Foto de ${criaBotLinkStatus.bot.display_name}`}
                              className="h-12 w-12 rounded-2xl object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                              <Bot className="h-6 w-6" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-semibold">
                              {criaBotLinkStatus.bot.display_name}
                            </p>
                            <p className="truncate text-muted-foreground">
                              @{criaBotLinkStatus.bot.username}
                            </p>
                          </div>
                        </div>
                      )}

                      {linkedCriaBotUser ? (
                        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                          <div className="flex items-start gap-4">
                            {linkedCriaBotUser.photo_data_url ? (
                              <img
                                src={linkedCriaBotUser.photo_data_url}
                                alt={`Foto de ${formatCriaBotUserName(linkedCriaBotUser)}`}
                                className="h-16 w-16 rounded-2xl object-cover"
                              />
                            ) : (
                              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                                <UserRound className="h-8 w-8" />
                              </div>
                            )}
                            <div className="min-w-0 text-sm">
                              <div className="flex items-center gap-2 font-semibold text-emerald-700">
                                <CheckCircle2 className="h-4 w-4" />
                                Telegram vinculado
                              </div>
                              <p className="mt-1 truncate font-display text-lg font-semibold">
                                {formatCriaBotUserName(linkedCriaBotUser)}
                              </p>
                              <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                                <span>ID: {linkedCriaBotUser.telegram_user_id}</span>
                                <span>
                                  Username:{" "}
                                  {linkedCriaBotUser.username
                                    ? `@${linkedCriaBotUser.username}`
                                    : "nao informado"}
                                </span>
                                <span>
                                  Idioma: {linkedCriaBotUser.language_code || "nao informado"}
                                </span>
                                <span>
                                  Premium Telegram: {linkedCriaBotUser.is_premium ? "sim" : "nao"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        criaBotLinkStatus?.configured &&
                        !criaBotLinkStatus.error && (
                          <p className="mt-3 text-sm text-muted-foreground">
                            Depois que o usuario abrir o bot oficial e der /start, o preview aparece
                            aqui automaticamente.
                          </p>
                        )
                      )}
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-display text-xl font-semibold">
                        Passo 2: configurar grupo/canal VIP
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        O bot precisa ser administrador desse grupo ou canal para entregar o convite
                        apos o pagamento.
                      </p>
                    </div>
                    <MiniTutorial
                      title="Como adicionar o VIP"
                      items={[
                        {
                          title: "Adicione o bot",
                          body: "Coloque o bot que voce esta criando dentro do grupo ou canal VIP.",
                        },
                        {
                          title: "Promova como admin",
                          body: "No Telegram, deixe o bot como administrador para ele conseguir gerar convite de acesso.",
                        },
                        {
                          title: "Cole o ID",
                          body: "Use o ID negativo do grupo/canal, normalmente comecando por -100, e clique em verificar.",
                        },
                      ]}
                    />
                    <div className="space-y-2">
                      <Label htmlFor="vip_chat_id">ID do grupo ou canal VIP</Label>
                      <Input
                        id="vip_chat_id"
                        value={vipChatId}
                        onChange={(event) => handleVipChatIdChange(event.target.value)}
                        placeholder="-1001234567890"
                        inputMode="numeric"
                        required
                        className={
                          vipChatId && !vipChatIdIsValid ? "border-destructive" : undefined
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Use o ID negativo do Telegram. Canais e supergrupos normalmente comecam com
                        -100.
                      </p>
                      {vipChatId && !vipChatIdIsValid && (
                        <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Informe um ID negativo valido.
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleVerifyVipChat}
                      disabled={
                        !validatedTokenIsCurrent ||
                        !vipChatIdIsValid ||
                        verifyVipChat.isPending ||
                        vipVerificationIsCurrent
                      }
                    >
                      {verifyVipChat.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : vipVerificationIsCurrent ? (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      ) : (
                        <ShieldCheck className="mr-2 h-4 w-4" />
                      )}
                      {vipVerificationIsCurrent ? "VIP verificado" : "Verificar grupo/canal VIP"}
                    </Button>
                    {vipPreviewIsCurrent && vipVerification && (
                      <div
                        className={`rounded-2xl border p-4 text-sm ${
                          vipVerification.ok
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-amber-200 bg-amber-50 text-amber-900"
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <div
                              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                                vipVerification.ok
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {vipVerification.ok ? (
                                <CheckCircle2 className="h-5 w-5" />
                              ) : (
                                <AlertCircle className="h-5 w-5" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold">
                                {vipVerification.chat?.title || "Grupo/canal encontrado"}
                              </p>
                              <p className="mt-1 text-xs opacity-80">
                                {formatTelegramChatType(vipVerification.chat?.type ?? null)} - ID{" "}
                                {vipVerification.chat_id}
                                {vipVerification.chat?.username
                                  ? ` - @${vipVerification.chat.username}`
                                  : ""}
                                {vipVerification.member_count != null
                                  ? ` - ${vipVerification.member_count} membro(s)`
                                  : ""}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${
                              vipVerification.ok
                                ? "bg-emerald-600 text-white"
                                : "bg-amber-200 text-amber-950"
                            }`}
                          >
                            {vipVerification.ok ? "Pronto" : "Precisa ajustar"}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          <div className="rounded-2xl bg-white/70 p-3">
                            <p className="text-xs opacity-70">Grupo/canal</p>
                            <p className="mt-1 font-semibold">
                              {vipVerification.chat ? "Encontrado" : "Nao encontrado"}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white/70 p-3">
                            <p className="text-xs opacity-70">Bot no grupo/canal</p>
                            <p className="mt-1 font-semibold">
                              {vipVerification.bot_in_chat ? "Sim" : "Nao"}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white/70 p-3">
                            <p className="text-xs opacity-70">Permissao do bot</p>
                            <p className="mt-1 font-semibold">
                              {vipVerification.is_admin
                                ? "Administrador"
                                : formatBotChatStatus(vipVerification.bot_status)}
                            </p>
                          </div>
                        </div>

                        {vipVerification.message && !vipVerification.ok && (
                          <p className="mt-3 rounded-2xl bg-white/70 p-3 text-xs font-medium">
                            {vipVerification.message}
                          </p>
                        )}
                      </div>
                    )}
                    {vipVerificationError && !vipPreviewIsCurrent && (
                      <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {vipVerificationError}
                      </p>
                    )}
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-5">
                    <div>
                      <h3 className="font-display text-xl font-semibold">
                        Passo 3: primeira mensagem e plano
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Essa mensagem aparece no /start e o plano ja fica ativo no bot.
                      </p>
                    </div>
                    <MiniTutorial
                      title="Como montar a primeira venda"
                      items={[
                        {
                          title: "Mensagem inicial",
                          body: "Escreva a chamada que aparece quando o cliente abre o bot com /start.",
                        },
                        {
                          title: "Plano e botao",
                          body: "Defina o nome do plano e, se quiser, um texto personalizado para o botao do Telegram.",
                        },
                        {
                          title: "Preco e validade",
                          body: "Escolha o valor e se o acesso sera por dias ou vitalicio. O Pix sera gerado nesse plano.",
                        },
                      ]}
                    />
                    <div className="space-y-2">
                      <Label htmlFor="welcome_message">Mensagem inicial do bot</Label>
                      <Textarea
                        id="welcome_message"
                        rows={4}
                        value={welcomeMessage}
                        onChange={(event) => setWelcomeMessage(event.target.value)}
                        required
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="plan_name">Nome do plano</Label>
                        <Input
                          id="plan_name"
                          value={planName}
                          onChange={(event) => setPlanName(event.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="plan_button_label">Texto do botao</Label>
                        <Input
                          id="plan_button_label"
                          value={planButtonLabel}
                          onChange={(event) => setPlanButtonLabel(event.target.value)}
                          placeholder="Vazio usa nome e preco"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan_detail_message">Mensagem ao abrir o plano</Label>
                      <Textarea
                        id="plan_detail_message"
                        rows={5}
                        value={planDetailMessage}
                        onChange={(event) => setPlanDetailMessage(event.target.value)}
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        Variaveis: {"{{nome}}"}, {"{{preco}}"}, {"{{validade}}"}.
                      </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="plan_price">Preco (R$)</Label>
                        <Input
                          id="plan_price"
                          value={planPrice}
                          onChange={(event) => setPlanPrice(event.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="plan_access_type">Validade</Label>
                        <select
                          id="plan_access_type"
                          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                          value={planAccessType}
                          onChange={(event) =>
                            setPlanAccessType(event.target.value as PlanAccessType)
                          }
                        >
                          <option value="days">Por dias</option>
                          <option value="lifetime">Vitalicio</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="plan_duration_days">Dias</Label>
                        <Input
                          id="plan_duration_days"
                          value={planDurationDays}
                          onChange={(event) => setPlanDurationDays(event.target.value)}
                          disabled={planAccessType === "lifetime"}
                          required={planAccessType === "days"}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-display text-xl font-semibold">
                        Passo 4: revisar e criar
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Confira tudo antes de criar. O banco separado sera criado automaticamente.
                      </p>
                    </div>
                    <MiniTutorial
                      title="Checklist final"
                      items={[
                        {
                          title: "Bot validado",
                          body: "Confirme se o nome e o @username batem com o bot certo do Telegram.",
                        },
                        {
                          title: "VIP pronto",
                          body: "Verifique se o bot esta como administrador no grupo ou canal que vai entregar acesso.",
                        },
                        {
                          title: "Criar bot",
                          body: "Ao finalizar, o CriaBot salva token, painel e banco separados para esse novo bot.",
                        },
                      ]}
                    />
                    <div className="grid gap-3 text-sm">
                      <div className="rounded-2xl bg-muted/60 p-4">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">Bot</p>
                        <p className="mt-1 font-semibold">
                          {validatedBot
                            ? `${validatedBot.display_name} (@${validatedBot.username})`
                            : "Nao validado"}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-muted/60 p-4">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          Grupo/canal VIP
                        </p>
                        <p className="mt-1 font-semibold">{vipChatId || "Nao informado"}</p>
                      </div>
                      <div className="rounded-2xl bg-muted/60 p-4">
                        <p className="text-xs font-semibold uppercase text-muted-foreground">
                          Plano inicial
                        </p>
                        <p className="mt-1 font-semibold">{planName || "Nao informado"}</p>
                        <p className="text-muted-foreground">
                          {planPriceIsValid ? formatCurrency(planPriceNumber) : "Preco invalido"} ·{" "}
                          {planAccessType === "lifetime"
                            ? "Vitalicio"
                            : `${planDurationDays || "0"} dias`}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <Button type="button" variant="outline" onClick={goBack} disabled={step === 1}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                  </Button>
                  {step < 4 ? (
                    <Button type="submit">
                      Continuar
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : (
                    <Button type="submit" disabled={!canCreateBot || createBot.isPending}>
                      {createBot.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}
                      {createBot.isPending ? "Criando..." : "Criar bot"}
                    </Button>
                  )}
                </div>
              </form>

              {step === 1 && <BotFatherTokenTutorialAside />}

              {step === 4 && (
                <aside className="rounded-3xl border bg-gradient-to-b from-primary/5 to-white p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    {validatedTokenIsCurrent ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                    Resumo em tempo real
                  </div>

                  {validatedTokenIsCurrent && validatedBot ? (
                    <div className="mt-5 flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
                      {validatedBot.photo_data_url ? (
                        <img
                          src={validatedBot.photo_data_url}
                          alt={`Foto de ${validatedBot.display_name}`}
                          className="h-16 w-16 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Bot className="h-8 w-8" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-display text-xl font-semibold">
                          {validatedBot.display_name}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          @{validatedBot.username}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ID Telegram: {validatedBot.telegram_id}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-dashed bg-white/70 p-5 text-sm text-muted-foreground">
                      Valide o token para aparecer a previa do Telegram.
                    </div>
                  )}

                  <div className="mt-5 space-y-3 text-sm">
                    <div className="rounded-2xl bg-white/80 p-4">
                      <div className="flex items-center gap-2 font-semibold">
                        <Users className="h-4 w-4 text-primary" />
                        VIP
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {vipVerificationIsCurrent
                          ? `Verificado: ${vipChatId}`
                          : vipChatIdIsValid
                            ? "Aguardando verificacao"
                            : "Aguardando ID do grupo/canal"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/80 p-4">
                      <div className="flex items-center gap-2 font-semibold">
                        <MessageSquareText className="h-4 w-4 text-primary" />
                        Plano
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {planName || "Sem nome"} ·{" "}
                        {planPriceIsValid ? formatCurrency(planPriceNumber) : "preco invalido"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/80 p-4 text-xs text-muted-foreground">
                      Quando criar, o CriaBot registra um bot proprio, cria o banco separado e grava
                      a mensagem inicial + primeiro plano nesse banco.
                    </div>
                  </div>
                </aside>
              )}
            </div>
          </section>
        )}

        {!isCreateMode && (
          <section className="mt-6">
            {botsQuery.isLoading && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-primary" />
                Consultando bots conectados...
              </Card>
            )}
            {botsQuery.isError && (
              <Card className="p-8 text-center">
                <p className="font-semibold text-destructive">
                  Não consegui consultar os bots agora.
                </p>
                <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
                  {botsQuery.error instanceof Error
                    ? botsQuery.error.message
                    : "Falha ao carregar a lista de bots."}
                </p>
                <Button className="mt-5 rounded-full" onClick={() => botsQuery.refetch()}>
                  Tentar novamente
                </Button>
              </Card>
            )}
            {!botsQuery.isLoading && !botsQuery.isError && bots.length > 0 && (
              <Card className="overflow-hidden border bg-card shadow-sm">
                <div className="hidden">
                  <span>Bot</span>
                  <span>Tipo</span>
                  <span>Status</span>
                  <span className="text-right">Acoes</span>
                </div>

                <div className="divide-y">
                  {bots.map((bot) => {
                    const Icon = bot.kind === "sales" ? Bot : Images;
                    const busy = action.isPending && action.variables?.key === bot.key;
                    return (
                      <div key={bot.key} className="px-4 py-4 transition hover:bg-muted/20 lg:px-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-4">
                            {bot.photo_data_url ? (
                              <img
                                src={bot.photo_data_url}
                                alt={`Foto de ${bot.display_name}`}
                                className="h-14 w-14 rounded-2xl object-cover"
                              />
                            ) : (
                              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                                <Icon className="h-7 w-7" />
                              </div>
                            )}
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[bot.status]}`}
                          >
                            {statusLabels[bot.status]}
                          </span>
                        </div>

                        <h2 className="mt-4 font-display text-lg font-semibold">
                          {bot.display_name}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {bot.username ? `@${bot.username}` : bot.status_message}
                        </p>
                        {bot.username && bot.status_message && (
                          <p
                            className={`mt-2 text-xs ${
                              bot.status === "error" ? "text-destructive" : "text-muted-foreground"
                            }`}
                          >
                            {bot.status_message}
                          </p>
                        )}
                        {bot.pending_updates > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {bot.pending_updates} atualização(ões) aguardando processamento
                          </p>
                        )}

                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <Button
                            variant="outline"
                            className="h-9 rounded-full text-xs"
                            disabled={!bot.configured || bot.status === "online" || busy}
                            onClick={() => action.mutate({ key: bot.key, action: "start" })}
                          >
                            <Play className="mr-1 h-4 w-4" /> Iniciar
                          </Button>
                          <Button
                            variant="outline"
                            className="h-9 rounded-full text-xs"
                            disabled={!bot.configured || bot.status === "stopped" || busy}
                            onClick={() => action.mutate({ key: bot.key, action: "stop" })}
                          >
                            <Square className="mr-1 h-4 w-4" /> Parar
                          </Button>
                          <Button
                            variant="outline"
                            className="h-9 rounded-full text-xs"
                            disabled={!bot.configured || busy}
                            onClick={() => action.mutate({ key: bot.key, action: "restart" })}
                          >
                            <RotateCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />{" "}
                            Reiniciar
                          </Button>
                        </div>

                        {bot.username ? (
                          <Button asChild className="mt-4 w-full rounded-full">
                            <Link to="/$bot/dashboard" params={{ bot: bot.username }}>
                              Abrir painel
                            </Link>
                          </Button>
                        ) : (
                          <Button className="mt-4 w-full rounded-full" disabled>
                            Configure o token para abrir
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
            {!botsQuery.isLoading && !botsQuery.isError && bots.length === 0 && (
              <Card className="p-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Bot className="h-7 w-7" />
                </div>
                <h2 className="mt-4 font-display text-2xl font-semibold">Nenhum bot cadastrado</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Crie o primeiro bot conectando um token do BotFather. O painel e o banco serao
                  gerados separadamente.
                </p>
                <Button asChild className="mt-5 rounded-full px-5">
                  <Link to="/painel/bots/novo-bot">
                    <Plus className="mr-2 h-4 w-4" />
                    Criar bot
                  </Link>
                </Button>
              </Card>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
