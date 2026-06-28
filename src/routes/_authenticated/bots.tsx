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
  Images,
  Loader2,
  LogOut,
  MessageSquareText,
  Play,
  Plus,
  RotateCw,
  ShieldCheck,
  Square,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createManagedSalesBot,
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

type VipVerificationResult = {
  ok: true;
  chat_id: number;
  bot_status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  member_count: number | null;
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

export function BotsPanelContent({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logoutFn = useServerFn(logoutAdminAccount);
  const sessionFn = useServerFn(getAdminSession);
  const listFn = useServerFn(getManagedBots);
  const actionFn = useServerFn(runManagedBotAction);
  const createBotFn = useServerFn(createManagedSalesBot);
  const validateTokenFn = useServerFn(validateManagedSalesBotToken);
  const verifyVipChatFn = useServerFn(verifyManagedSalesBotVipChat);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
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

  const createBot = useMutation({
    mutationFn: (data: CreateManagedBotInput) => createBotFn({ data }),
    onSuccess: async (result) => {
      setToken("");
      setValidatedBot(null);
      setValidationError(null);
      setVipChatId("");
      setStep(1);
      setShowCreateWizard(false);
      await qc.invalidateQueries({ queryKey: ["managed-bots"] });
      toast.success(`Bot @${result.bot.username} cadastrado`);
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
      setVipVerificationError(null);
      toast.success("Grupo/canal VIP verificado");
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
  const role = sessionQuery.data?.admin?.role ?? "creator";
  const isAdmin = role === "admin";
  const cleanToken = token.trim();
  const hasToken = cleanToken.length > 0;
  const tokenHasValidFormat = !hasToken || telegramBotTokenPattern.test(cleanToken);
  const validatedTokenIsCurrent = Boolean(validatedBot && validatedBot.token === cleanToken);
  const vipChatIdNumber = Number(vipChatId.trim());
  const vipChatIdIsValid =
    /^-?\d+$/.test(vipChatId.trim()) && Number.isInteger(vipChatIdNumber) && vipChatIdNumber < 0;
  const vipVerificationIsCurrent =
    Boolean(vipVerification) && vipVerification?.chat_id === vipChatIdNumber;
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

  return (
    <main
      className={
        embedded
          ? "relative overflow-hidden"
          : "relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_15%_0%,rgba(26,115,232,.14),transparent_28rem),linear-gradient(180deg,#ffffff_0%,#f8fafd_100%)] px-4 py-6 sm:px-5 sm:py-12"
      }
    >
      <div className="pointer-events-none absolute right-[-12rem] top-[-12rem] h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div
        className={
          embedded
            ? "relative mx-auto w-full max-w-6xl"
            : "relative mx-auto flex w-full max-w-6xl flex-col justify-start md:min-h-[calc(100vh-6rem)] md:justify-center"
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {!embedded && <BrandMark subtitle="Painel da plataforma" />}
            <h1
              className={`font-display text-3xl font-semibold leading-tight sm:text-4xl ${
                embedded ? "" : "mt-6 sm:mt-8"
              }`}
            >
              {embedded ? "Bots" : "Escolha qual bot deseja gerenciar"}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {isAdmin
                ? "Voce esta na conta admin da plataforma. Gerencie os bots principais e os bots dos criadores."
                : "Cadastre o token do seu bot do Telegram para criar um painel e banco proprios."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 self-start sm:self-auto">
            {showCreateWizard ? (
              <Button variant="outline" onClick={() => setShowCreateWizard(false)}>
                <Bot className="mr-2 h-4 w-4" />
                Ver bots
              </Button>
            ) : (
              <Button onClick={() => setShowCreateWizard(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Criar bot
              </Button>
            )}
            {!embedded && (
              <Button variant="ghost" onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" /> Sair
              </Button>
            )}
          </div>
        </div>

        {showCreateWizard && (
          <Card
            className={`overflow-hidden border bg-white/90 p-5 shadow-sm backdrop-blur sm:p-6 ${
              embedded ? "mt-6" : "mt-8"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  Onboarding guiado
                </div>
                <h2 className="mt-3 font-display text-2xl font-semibold">
                  Crie um bot pronto para vender
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Configure o Telegram, o grupo VIP e o primeiro plano. O CriaBot cria o bot no
                  sistema atual com banco separado.
                </p>
              </div>
              <div className="text-sm text-muted-foreground">Passo {step} de 4</div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              {wizardSteps.map((item) => {
                const Icon = item.icon;
                const active = item.id === step;
                const done = item.id < step;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStep(item.id)}
                    className={`rounded-2xl border p-3 text-left transition ${
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : done
                          ? "border-primary/30 bg-primary/5"
                          : "bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full ${
                          active ? "bg-white/20" : "bg-primary/10 text-primary"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-xs font-semibold">Passo {item.id}</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold">{item.title}</p>
                    <p
                      className={`mt-1 text-xs ${active ? "text-white/80" : "text-muted-foreground"}`}
                    >
                      {item.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
              <form
                className="rounded-3xl border bg-white p-5"
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
                      <p className="mt-1 text-sm text-muted-foreground">
                        Cole o token do BotFather. Antes de salvar, vamos consultar o Telegram.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="telegram_token">Token do bot</Label>
                      <Input
                        id="telegram_token"
                        value={token}
                        onChange={(event) => handleTokenChange(event.target.value)}
                        placeholder="1234567890:ABC..."
                        type="password"
                        autoComplete="off"
                        required
                        className={
                          !tokenHasValidFormat || validationError ? "border-destructive" : undefined
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Formato esperado: numeros, dois pontos e a chave secreta do BotFather.
                      </p>
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
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleValidateToken}
                      disabled={!hasToken || !tokenHasValidFormat || validateToken.isPending}
                    >
                      {validateToken.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="mr-2 h-4 w-4" />
                      )}
                      {validateToken.isPending ? "Validando..." : "Validar token"}
                    </Button>
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
                    {vipVerificationIsCurrent && (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                        Bot confirmado como administrador
                        {vipVerification?.member_count != null
                          ? ` · ${vipVerification.member_count} membro(s)`
                          : ""}
                        .
                      </div>
                    )}
                    {vipVerificationError && (
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
                    Quando criar, o CriaBot registra um bot proprio, cria o banco separado e grava a
                    mensagem inicial + primeiro plano nesse banco.
                  </div>
                </div>
              </aside>
            </div>
          </Card>
        )}

        <div className={`${showCreateWizard ? "mt-10" : "mt-8"} grid gap-6 md:grid-cols-2`}>
          {botsQuery.isLoading && (
            <Card className="col-span-full p-8 text-center text-muted-foreground">
              Consultando os bots no Telegram...
            </Card>
          )}
          {botsQuery.isError && (
            <Card className="col-span-full p-8 text-center">
              <p className="font-semibold text-destructive">
                Não consegui consultar os bots agora.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {botsQuery.error instanceof Error
                  ? botsQuery.error.message
                  : "Falha ao carregar a lista de bots."}
              </p>
              <Button className="mt-5" onClick={() => botsQuery.refetch()}>
                Tentar novamente
              </Button>
            </Card>
          )}
          {bots.map((bot) => {
            const Icon = bot.kind === "sales" ? Bot : Images;
            const busy = action.isPending && action.variables?.key === bot.key;
            return (
              <Card key={bot.key} className="flex h-full flex-col bg-white/95 p-5 shadow-sm sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {bot.photo_data_url ? (
                      <img
                        src={bot.photo_data_url}
                        alt={`Foto de ${bot.display_name}`}
                        className="h-16 w-16 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <Icon className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[bot.status]}`}
                  >
                    {statusLabels[bot.status]}
                  </span>
                </div>

                <h2 className="mt-5 font-display text-2xl font-semibold">{bot.display_name}</h2>
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

                <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Button
                    variant="outline"
                    disabled={!bot.configured || bot.status === "online" || busy}
                    onClick={() => action.mutate({ key: bot.key, action: "start" })}
                  >
                    <Play className="mr-1 h-4 w-4" /> Iniciar
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!bot.configured || bot.status === "stopped" || busy}
                    onClick={() => action.mutate({ key: bot.key, action: "stop" })}
                  >
                    <Square className="mr-1 h-4 w-4" /> Parar
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!bot.configured || busy}
                    onClick={() => action.mutate({ key: bot.key, action: "restart" })}
                  >
                    <RotateCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Reiniciar
                  </Button>
                </div>

                {bot.username ? (
                  <Button asChild className="mt-5 w-full">
                    <Link to="/$bot/dashboard" params={{ bot: bot.username }}>
                      Abrir painel
                    </Link>
                  </Button>
                ) : (
                  <Button className="mt-5 w-full" disabled>
                    Configure o token para abrir
                  </Button>
                )}
              </Card>
            );
          })}
          {!botsQuery.isLoading && !botsQuery.isError && bots.length === 0 && (
            <Card className="col-span-full p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Bot className="h-7 w-7" />
              </div>
              <h2 className="mt-4 font-display text-2xl font-semibold">Nenhum bot cadastrado</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Clique em Criar bot para cadastrar o primeiro token do BotFather dessa conta.
              </p>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
