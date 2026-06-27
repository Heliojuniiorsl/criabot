"use client";

import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Send,
  Users,
  UserRound,
  Video,
  WandSparkles,
  X,
  CirclePlay,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  type AppUser,
  type BotItem,
  type BotStatus,
  type TelegramAccountLinkState,
  type TelegramBotPreview,
  type TelegramBotSetupInput,
  type TelegramFirstPlan,
  type TelegramPlanInterval,
  type TelegramUserPreview,
  type TelegramVipCommunity,
  type TelegramVipCommunityVerification,
  type TelegramWelcomeMedia,
  checkDatabaseReady,
  connectTelegramBot,
  controlLocalTelegramBot,
  deleteBot as deleteRemoteBot,
  getCurrentUser,
  getTelegramAccountLinkStatus,
  listBots,
  prepareTelegramBotForVip,
  previewTelegramBot,
  registerLocalTelegramBot,
  signIn,
  signOut,
  signUp,
  startTelegramAccountLink,
  updateBot as updateRemoteBot,
  updateProfile,
  verifyTelegramVipCommunity,
} from "@/lib/bot-repository";

type Screen = "dashboard" | "bots" | "create" | "analytics" | "settings";
type AuthScreen = "login" | "signup";

type PasswordStrength = {
  label: "Fraca" | "Razoável" | "Bom" | "Forte";
  color: string;
  width: string;
};

function getPasswordStrength(password: string): PasswordStrength | null {
  if (!password) return null;

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) {
    return { label: "Fraca", color: "bg-[#ff5c7a]", width: "w-1/4" };
  }
  if (score === 2) {
    return { label: "Razoável", color: "bg-[#ffbd59]", width: "w-2/4" };
  }
  if (score === 3) {
    return { label: "Bom", color: "bg-[#8ddc54]", width: "w-3/4" };
  }
  return { label: "Forte", color: "bg-[#c8ff4d]", width: "w-full" };
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function isValidTelegramToken(value: string) {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

const navItems = [
  { id: "dashboard" as Screen, label: "Visão geral", icon: LayoutDashboard },
  { id: "bots" as Screen, label: "Meus bots", icon: Bot },
  { id: "analytics" as Screen, label: "Desempenho", icon: BarChart3 },
  { id: "settings" as Screen, label: "Configurações", icon: Settings },
];

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Image
        src="/criabot-mark.png"
        alt="Símbolo CriaBot"
        width={44}
        height={44}
        priority
        className="size-11 shrink-0 rounded-[13px] object-cover shadow-[0_0_28px_rgba(184,255,30,.16)]"
      />
      {!compact && (
        <div>
          <div className="text-[19px] font-black tracking-[-0.055em]">
            <span className="text-white">Cria</span>
            <span className="text-[#b8ff1e]">Bot</span>
          </div>
          <div className="-mt-0.5 text-[8px] font-bold uppercase tracking-[0.2em] text-[#777382]">
            Painel inteligente
          </div>
        </div>
      )}
    </div>
  );
}

function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const styles = {
    primary: "light-on-blue rounded-full bg-[#c8ff4d] text-white hover:bg-[#0b57d0] shadow-[0_8px_24px_rgba(26,115,232,.18)]",
    secondary: "border border-white/10 bg-white/[.055] text-white hover:bg-white/[.09]",
    ghost: "text-[#aaa6b4] hover:bg-white/[.055] hover:text-white",
    danger: "bg-[#ff5c7a]/12 text-[#ff7d94] hover:bg-[#ff5c7a]/18",
  };
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-[#c8ff4d]" : "bg-white/15"}`}
    >
      <span className={`absolute top-1 size-4 rounded-full transition-all ${checked ? "left-6 bg-[#0b0b0d]" : "left-1 bg-white/70"}`} />
    </button>
  );
}

function Auth({
  mode,
  setMode,
  onAuth,
  databaseReady,
}: {
  mode: AuthScreen;
  setMode: (mode: AuthScreen) => void;
  onAuth: (input: {
    mode: AuthScreen;
    name: string;
    email: string;
    phone: string;
    password: string;
  }) => Promise<string | null>;
  databaseReady: boolean | null;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [phone, setPhone] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const isSignup = mode === "signup";
  const passwordStrength = getPasswordStrength(password);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (isSignup && password !== passwordConfirmation) {
      setFeedback({ type: "error", message: "As senhas não coincidem." });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const message = await onAuth({
        mode,
        name: String(form.get("name") || "Criador"),
        email: String(form.get("email") || ""),
        phone,
        password,
      });
      if (message) setFeedback({ type: "success", message });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível concluir. Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="noise soft-grid min-h-screen overflow-hidden">
      <div className="mx-auto grid min-h-screen max-w-[1440px] lg:grid-cols-[1.08fr_.92fr]">
        <section className="relative hidden overflow-hidden p-12 lg:flex lg:flex-col">
          <Brand />
          <div className="relative z-10 my-auto max-w-[620px]">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#c8ff4d]/20 bg-[#c8ff4d]/[.07] px-3 py-1.5 text-xs font-extrabold text-[#d8ff80]">
              <Sparkles size={13} /> Sua operação, mais inteligente
            </div>
            <h1 className="text-[clamp(3.5rem,5.6vw,6.7rem)] font-black leading-[.88] tracking-[-.075em]">
              Crie bots.<br /><span className="text-[#c8ff4d]">Ganhe escala.</span>
            </h1>
            <p className="mt-8 max-w-lg text-lg leading-8 text-[#aaa6b4]">
              Configure personalidades, canais e regras em minutos. Administre tudo em um painel desenhado para criadores.
            </p>
            <div className="mt-10 flex flex-wrap gap-3 text-sm font-bold text-[#c4c0cb]">
              {["Controle central", "Bots para qualquer negócio", "Pronto para mobile"].map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.035] px-3.5 py-2.5">
                  <Check size={15} className="text-[#c8ff4d]" /> {item}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -bottom-40 -right-36 size-[520px] rounded-full bg-[#7c5cff]/15 blur-[100px]" />
        </section>

        <section className="flex min-h-screen items-center justify-center border-l border-white/[.06] bg-[#0d0c12]/75 px-5 py-10 backdrop-blur-sm sm:px-10">
          <div className="w-full max-w-[445px] animate-rise">
            <div className="mb-10 lg:hidden"><Brand /></div>
            <div className="mb-8">
              <div
                className={`mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-extrabold ${
                  databaseReady === false
                    ? "border-[#ffbd59]/20 bg-[#ffbd59]/[.07] text-[#ffd18b]"
                    : "border-[#c8ff4d]/20 bg-[#c8ff4d]/[.07] text-[#d8ff80]"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    databaseReady === false ? "bg-[#ffbd59]" : "bg-[#c8ff4d]"
                  }`}
                />
                {databaseReady === null
                  ? "VERIFICANDO ACESSO"
                  : databaseReady
                    ? "AMBIENTE SEGURO"
                    : "CONFIGURAÇÃO PENDENTE"}
              </div>
              <p className="mb-2 text-sm font-extrabold text-[#c8ff4d]">{isSignup ? "COMECE AGORA" : "BEM-VINDO DE VOLTA"}</p>
              <h2 className="text-3xl font-black tracking-[-.045em] sm:text-4xl">{isSignup ? "Crie sua conta" : "Entre no seu painel"}</h2>
              <p className="mt-3 text-sm leading-6 text-[#8f8b99]">
                {isSignup ? "Leva menos de um minuto. Você poderá criar seu primeiro bot em seguida." : "Acesse seus bots, métricas e configurações."}
              </p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              {isSignup && (
                <label className="block">
                  <span className="mb-2 block text-xs font-extrabold text-[#b8b4c0]">Seu nome</span>
                  <input className="field" name="name" placeholder="Seu nome" required />
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-xs font-extrabold text-[#b8b4c0]">E-mail</span>
                <input className="field" name="email" type="email" placeholder="voce@exemplo.com" required />
              </label>
              {isSignup && (
                <label className="block">
                  <span className="mb-2 block text-xs font-extrabold text-[#b8b4c0]">Telefone</span>
                  <input
                    className="field"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(event) => setPhone(formatPhone(event.target.value))}
                    placeholder="(11) 99999-9999"
                    minLength={14}
                    required
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-xs font-extrabold text-[#b8b4c0]">Senha</span>
                <div className="relative">
                  <input
                    className="field pr-12"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Mínimo de 8 caracteres"
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    minLength={8}
                    required
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-[#777382] hover:text-white" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {isSignup && passwordStrength && (
                  <div className="mt-2">
                    <div className="mb-1.5 flex items-center justify-between text-[10px]">
                      <span className="text-[#716d7a]">Força da senha</span>
                      <span className="font-extrabold text-[#aaa6b4]">
                        {passwordStrength.label}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[.07]">
                      <div
                        className={`h-full rounded-full transition-all ${passwordStrength.color} ${passwordStrength.width}`}
                      />
                    </div>
                  </div>
                )}
              </label>
              {isSignup && (
                <>
                  <label className="block">
                    <span className="mb-2 block text-xs font-extrabold text-[#b8b4c0]">
                      Confirme sua senha
                    </span>
                    <div className="relative">
                      <input
                        className={`field pr-12 ${
                          passwordConfirmation &&
                          password !== passwordConfirmation
                            ? "border-[#ff5c7a]/60"
                            : ""
                        }`}
                        name="passwordConfirmation"
                        type={showPasswordConfirmation ? "text" : "password"}
                        value={passwordConfirmation}
                        onChange={(event) =>
                          setPasswordConfirmation(event.target.value)
                        }
                        placeholder="Digite a senha novamente"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowPasswordConfirmation((value) => !value)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-[#777382] hover:text-white"
                        aria-label={
                          showPasswordConfirmation
                            ? "Ocultar confirmação de senha"
                            : "Mostrar confirmação de senha"
                        }
                      >
                        {showPasswordConfirmation ? (
                          <EyeOff size={17} />
                        ) : (
                          <Eye size={17} />
                        )}
                      </button>
                    </div>
                    {passwordConfirmation && (
                      <span
                        className={`mt-1.5 block text-[10px] ${
                          password === passwordConfirmation
                            ? "text-[#c8ff4d]"
                            : "text-[#ff7d94]"
                        }`}
                      >
                        {password === passwordConfirmation
                          ? "As senhas coincidem"
                          : "As senhas não coincidem"}
                      </span>
                    )}
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 pt-1 text-xs leading-5 text-[#8f8b99]">
                    <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 accent-[#c8ff4d]" />
                    <span>
                      Li e aceito a{" "}
                      <a
                        href="/privacidade"
                        target="_blank"
                        className="font-bold text-white underline decoration-white/25 underline-offset-2 hover:text-[#c8ff4d]"
                      >
                        Política de Privacidade
                      </a>{" "}
                      e os{" "}
                      <a
                        href="/termos"
                        target="_blank"
                        className="font-bold text-white underline decoration-white/25 underline-offset-2 hover:text-[#c8ff4d]"
                      >
                        Termos de Uso
                      </a>
                      .
                    </span>
                  </label>
                </>
              )}
              {feedback && (
                <div
                  className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-5 ${
                    feedback.type === "error"
                      ? "border-[#ff5c7a]/20 bg-[#ff5c7a]/[.07] text-[#ff9cad]"
                      : "border-[#c8ff4d]/20 bg-[#c8ff4d]/[.07] text-[#d8ff80]"
                  }`}
                >
                  {feedback.type === "error" ? (
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  ) : (
                    <Check size={15} className="mt-0.5 shrink-0" />
                  )}
                  {feedback.message}
                </div>
              )}
              {databaseReady === false && (
                <div className="flex items-start gap-2 rounded-xl border border-[#ffbd59]/20 bg-[#ffbd59]/[.07] p-3 text-xs leading-5 text-[#ffd18b]">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  A configuração inicial do sistema precisa ser concluída antes de
                  liberar contas.
                </div>
              )}
              <Button
                className="mt-2 w-full"
                type="submit"
                disabled={
                  loading || databaseReady !== true || (isSignup && !accepted)
                  || (isSignup && password !== passwordConfirmation)
                }
              >
                {loading
                  ? "Processando..."
                  : isSignup
                    ? "Criar minha conta"
                    : "Entrar no painel"}{" "}
                {!loading && <ArrowRight size={17} />}
              </Button>
            </form>
            <p className="mt-8 text-center text-sm text-[#7e7a87]">
              {isSignup ? "Já tem uma conta?" : "Ainda não tem uma conta?"}{" "}
              <button
                onClick={() => {
                  setFeedback(null);
                  setPassword("");
                  setPasswordConfirmation("");
                  setMode(isSignup ? "login" : "signup");
                }}
                className="font-extrabold text-white hover:text-[#c8ff4d]"
              >
                {isSignup ? "Entrar" : "Criar agora"}
              </button>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Sidebar({
  screen,
  setScreen,
  user,
  onLogout,
  mobileOpen,
  closeMobile,
  botCount,
}: {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  user: AppUser;
  onLogout: () => void;
  mobileOpen: boolean;
  closeMobile: () => void;
  botCount: number;
}) {
  return (
    <>
      {mobileOpen && <button className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm lg:hidden" onClick={closeMobile} aria-label="Fechar menu" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[276px] flex-col border-r border-white/[.07] bg-[#0d0c12]/95 p-5 backdrop-blur-xl transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-1 py-2">
          <Brand />
          <button onClick={closeMobile} className="rounded-lg p-2 text-[#8b8794] hover:bg-white/5 lg:hidden"><X size={19} /></button>
        </div>
        <Button className="my-8 w-full" onClick={() => setScreen("create")}><Plus size={17} strokeWidth={2.8} /> Criar novo bot</Button>
        <nav className="space-y-1.5">
          <p className="mb-3 px-3 text-[10px] font-black uppercase tracking-[.18em] text-[#625e6b]">Workspace</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = screen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setScreen(item.id); closeMobile(); }}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-bold transition ${active ? "bg-white/[.075] text-white" : "text-[#8f8b99] hover:bg-white/[.04] hover:text-white"}`}
              >
                <Icon size={19} className={active ? "text-[#c8ff4d]" : ""} strokeWidth={active ? 2.4 : 1.9} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto">
          <div className="mb-4 rounded-2xl border border-[#7c5cff]/20 bg-[#7c5cff]/[.08] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-extrabold text-[#c9beff]"><Sparkles size={14} /> Plano Creator</div>
            <p className="text-[11px] leading-5 text-[#8e899c]">
              {botCount} de 5 bots utilizados.
            </p>
            <div className="mt-3 h-1.5 rounded-full bg-white/[.06]">
              <div
                className="h-full rounded-full bg-[#7c5cff] transition-all"
                style={{ width: `${Math.min((botCount / 5) * 100, 100)}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-white/[.07] pt-5">
            <div className="light-on-blue grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1a73e8] to-[#0b57d0] text-sm font-black text-white">{user.name.slice(0, 2).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{user.name}</p><p className="truncate text-[10px] text-[#777382]">{user.email}</p></div>
            <button onClick={onLogout} className="rounded-lg p-2 text-[#777382] hover:bg-white/5 hover:text-white" title="Sair"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ title, onMenu }: { title: string; onMenu: () => void }) {
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      }).format(new Date()),
    [],
  );

  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-white/[.06] bg-[#09090d]/75 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="rounded-xl border border-white/[.08] p-2.5 text-[#aaa6b4] lg:hidden"><Menu size={19} /></button>
        <div><h1 className="text-base font-black tracking-[-.025em] sm:text-lg">{title}</h1><p className="hidden capitalize text-[10px] text-[#716d7a] sm:block">{today}</p></div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative hidden sm:block">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#686472]" />
          <input className="h-10 w-52 rounded-xl border border-white/[.07] bg-white/[.035] pl-9 pr-3 text-xs outline-none focus:border-white/15" placeholder="Buscar no painel..." />
        </div>
        <button className="relative rounded-xl border border-white/[.07] bg-white/[.035] p-2.5 text-[#aaa6b4] hover:bg-white/[.07]"><Bell size={18} /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#c8ff4d]" /></button>
        <button className="hidden rounded-xl border border-white/[.07] bg-white/[.035] p-2.5 text-[#aaa6b4] hover:bg-white/[.07] sm:block"><CircleHelp size={18} /></button>
      </div>
    </header>
  );
}

function StatCard({ label, value, change, icon: Icon, accent }: { label: string; value: string; change: string; icon: React.ElementType; accent: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <div><p className="text-xs font-bold text-[#827e8b]">{label}</p><p className="mt-3 text-2xl font-black tracking-[-.04em] sm:text-3xl">{value}</p></div>
        <div className={`grid size-10 place-items-center rounded-xl ${accent}`}><Icon size={18} /></div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[11px]"><span className="font-extrabold text-[#c8ff4d]">{change}</span><span className="text-[#666270]">nos últimos 7 dias</span></div>
    </div>
  );
}

function StatusBadge({ status }: { status: BotStatus }) {
  const config = {
    active: ["Ativo", "bg-[#c8ff4d]/10 text-[#c8ff4d]", "bg-[#c8ff4d]"],
    draft: ["Rascunho", "bg-white/[.07] text-[#aaa6b4]", "bg-[#777382]"],
    paused: ["Pausado", "bg-[#ffbd59]/10 text-[#ffc96f]", "bg-[#ffbd59]"],
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold ${config[status][1]}`}>
      <span className={`size-1.5 rounded-full ${config[status][2]}`} /> {config[status][0]}
    </span>
  );
}

function ConnectionBadge({ bot }: { bot: BotItem }) {
  const telegramConnected = bot.telegram?.status === "connected";
  const label = telegramConnected
    ? "Telegram conectado"
    : bot.telegram
      ? "Token validado"
      : "Canal pendente";
  const styles = telegramConnected
    ? "bg-[#34a8e0]/10 text-[#7ad4ff]"
    : bot.telegram
      ? "bg-[#ffbd59]/10 text-[#ffc96f]"
      : "bg-white/[.07] text-[#8f8b99]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold ${styles}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function BotCard({
  bot,
  onManage,
  onStartLocal,
  onRestartLocal,
  onStopLocal,
  onDelete,
}: {
  bot: BotItem;
  onManage: () => void;
  onStartLocal: () => void;
  onRestartLocal: () => void;
  onStopLocal: () => void;
  onDelete: () => void;
}) {
  const canControlLocal =
    Boolean(bot.telegram) && bot.platform.toLowerCase() === "telegram";
  return (
    <article className="glass group rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-white/[.14]">
      <div className="flex items-start justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`grid size-12 shrink-0 place-items-center rounded-2xl ${bot.status === "active" ? "bg-[#c8ff4d] text-black" : "bg-white/[.065] text-[#8f8b99]"}`}><Bot size={22} /></div>
          <div className="min-w-0"><h3 className="truncate text-sm font-black">{bot.name}</h3><p className="mt-0.5 truncate text-[11px] text-[#777382]">{bot.handle} · {bot.platform}</p></div>
        </div>
        <button className="rounded-lg p-2 text-[#65616e] hover:bg-white/5 hover:text-white"><MoreHorizontal size={18} /></button>
      </div>
      <p className="mt-4 line-clamp-2 min-h-10 text-xs leading-5 text-[#918d9a]">{bot.description}</p>
      <div className="mt-3">
        <ConnectionBadge bot={bot} />
      </div>
      {canControlLocal && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onStartLocal}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#d2e3fc] bg-[#e8f0fe] px-2.5 py-2 text-[11px] font-black text-[#174ea6] transition hover:bg-[#d2e3fc]"
          >
            <CirclePlay size={14} /> Iniciar
          </button>
          <button
            type="button"
            onClick={onRestartLocal}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#d2e3fc] bg-white px-2.5 py-2 text-[11px] font-black text-[#174ea6] transition hover:bg-[#e8f0fe]"
          >
            <RotateCcw size={14} /> Reiniciar
          </button>
          <button
            type="button"
            onClick={onStopLocal}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-[#ffd8a8] bg-[#fff7ed] px-2.5 py-2 text-[11px] font-black text-[#b45309] transition hover:bg-[#ffedd5]"
          >
            <Square size={13} /> Parar
          </button>
        </div>
      )}
      <div className="my-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/[.035] p-3"><div className="flex items-center gap-1.5 text-[10px] text-[#716d7a]"><MessageCircle size={12} /> Mensagens</div><p className="mt-1 text-sm font-black">{bot.messages.toLocaleString("pt-BR")}</p></div>
        <div className="rounded-xl bg-white/[.035] p-3"><div className="flex items-center gap-1.5 text-[10px] text-[#716d7a]"><Users size={12} /> Audiência</div><p className="mt-1 text-sm font-black">{bot.audience.toLocaleString("pt-BR")}</p></div>
      </div>
      <div className="flex items-center justify-between border-t border-white/[.06] pt-4">
        <StatusBadge status={bot.status} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="grid size-8 place-items-center rounded-lg bg-[#fce8e6] text-[#c5221f] hover:bg-[#fad2cf]"
            aria-label={`Excluir ${bot.name}`}
          >
            <Trash2 size={15} />
          </button>
          <button onClick={onManage} className="grid size-8 place-items-center rounded-lg bg-white/[.05] text-[#aaa6b4] hover:bg-white/[.09] hover:text-white" aria-label={`Gerenciar ${bot.name}`}><ChevronRight size={16} /></button>
        </div>
      </div>
    </article>
  );
}

function Dashboard({
  bots,
  setScreen,
  onManage,
  onStartLocal,
  onRestartLocal,
  onStopLocal,
  onDelete,
}: {
  bots: BotItem[];
  setScreen: (screen: Screen) => void;
  onManage: (id: string) => void;
  onStartLocal: (id: string) => void;
  onRestartLocal: (id: string) => void;
  onStopLocal: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const active = bots.filter((bot) => bot.status === "active").length;
  const totalMessages = bots.reduce((total, bot) => total + bot.messages, 0);
  const audience = bots.reduce((total, bot) => total + bot.audience, 0);
  const chart = [34, 52, 46, 68, 58, 82, 74, 91, 78, 96, 88, 100];

  return (
    <div className="animate-rise space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-[#dfe7f5] bg-gradient-to-r from-[#f8f7f4] to-[#e8f0fe] px-6 py-7 sm:px-8">
        <div className="relative z-10 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-extrabold text-[#c8ff4d]"><WandSparkles size={15} /> SUA CENTRAL DE CRIAÇÃO</div>
            <h2 className="max-w-xl text-2xl font-black tracking-[-.045em] sm:text-3xl">Pronto para colocar uma nova ideia no ar?</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#5f6368]">Crie a personalidade, defina as proteções e publique seu próximo bot.</p>
          </div>
          <Button onClick={() => setScreen("create")} className="shrink-0"><Plus size={17} /> Criar bot</Button>
        </div>
        <Bot className="absolute -bottom-12 right-6 size-44 rotate-[-8deg] text-white/[.025]" />
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Bots ativos" value={String(active)} change="+1" icon={Bot} accent="bg-[#c8ff4d]/10 text-[#c8ff4d]" />
        <StatCard label="Mensagens" value={totalMessages.toLocaleString("pt-BR")} change="+18,2%" icon={MessageCircle} accent="bg-[#e8f0fe] text-[#1a73e8]" />
        <StatCard label="Audiência" value={audience.toLocaleString("pt-BR")} change="+12,4%" icon={Users} accent="bg-[#e8f0fe] text-[#1a73e8]" />
        <StatCard label="Taxa de resposta" value="94,8%" change="+3,1%" icon={Activity} accent="bg-[#e8f0fe] text-[#1a73e8]" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.5fr_.75fr]">
        <div className="glass rounded-2xl p-5 sm:p-6">
          <div className="flex items-start justify-between">
            <div><h3 className="text-sm font-black">Conversas iniciadas</h3><p className="mt-1 text-[11px] text-[#777382]">Últimos 12 dias</p></div>
            <span className="rounded-lg bg-[#c8ff4d]/10 px-2.5 py-1 text-[10px] font-extrabold text-[#c8ff4d]">+18,2%</span>
          </div>
          <div className="mt-8 flex h-40 items-end gap-2 sm:gap-3">
            {chart.map((height, index) => (
              <div key={index} className="group flex h-full flex-1 items-end">
                <div className={`w-full rounded-t-md transition group-hover:brightness-105 ${index === chart.length - 1 ? "bg-[#0b57d0]" : "bg-gradient-to-t from-[#d2e3fc] to-[#4285f4]"}`} style={{ height: `${height}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between text-[9px] text-[#5f5b69]"><span>10 jun</span><span>14 jun</span><span>18 jun</span><span>Hoje</span></div>
        </div>
        <div className="glass rounded-2xl p-5 sm:p-6">
          <div className="flex items-start justify-between"><div><h3 className="text-sm font-black">Saúde da operação</h3><p className="mt-1 text-[11px] text-[#777382]">Tudo sob controle</p></div><ShieldCheck size={20} className="text-[#c8ff4d]" /></div>
          <div className="mt-6 space-y-4">
            {[
              ["Moderação de conteúdo", "Ativa em todos", true],
              ["Proteção anti-spam", "Ativa em todos", true],
              ["Marca d'água", "Ativa em todos", true],
              ["Integrações", "1 configuração pendente", false],
            ].map(([title, subtitle, ok]) => (
              <div key={String(title)} className="flex items-center gap-3">
                <div className={`grid size-8 shrink-0 place-items-center rounded-lg ${ok ? "bg-[#c8ff4d]/10 text-[#c8ff4d]" : "bg-[#ffbd59]/10 text-[#ffbd59]"}`}>{ok ? <Check size={15} /> : <Clock3 size={15} />}</div>
                <div><p className="text-xs font-extrabold">{title}</p><p className="mt-0.5 text-[10px] text-[#716d7a]">{subtitle}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <div><h3 className="text-base font-black">Seus bots</h3><p className="mt-1 text-[11px] text-[#777382]">Acesso rápido à sua operação</p></div>
          <button onClick={() => setScreen("bots")} className="flex items-center gap-1 text-xs font-extrabold text-[#aaa6b4] hover:text-white">Ver todos <ChevronRight size={14} /></button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bots.slice(0, 3).map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onManage={() => onManage(bot.id)}
              onStartLocal={() => onStartLocal(bot.id)}
              onRestartLocal={() => onRestartLocal(bot.id)}
              onStopLocal={() => onStopLocal(bot.id)}
              onDelete={() => onDelete(bot.id)}
            />
          ))}
          <button onClick={() => setScreen("create")} className="group min-h-64 rounded-2xl border border-dashed border-white/[.12] p-6 text-center transition hover:border-[#c8ff4d]/35 hover:bg-[#c8ff4d]/[.025]">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-white/[.05] text-[#85818e] transition group-hover:bg-[#c8ff4d] group-hover:text-black"><Plus size={21} /></div>
            <p className="mt-4 text-sm font-black">Criar outro bot</p><p className="mx-auto mt-2 max-w-48 text-[11px] leading-5 text-[#716d7a]">Transforme uma nova persona em operação.</p>
          </button>
        </div>
      </section>
    </div>
  );
}

function BotsScreen({
  bots,
  setScreen,
  onManage,
  onStartLocal,
  onRestartLocal,
  onStopLocal,
  onDelete,
}: {
  bots: BotItem[];
  setScreen: (screen: Screen) => void;
  onManage: (id: string) => void;
  onStartLocal: (id: string) => void;
  onRestartLocal: (id: string) => void;
  onStopLocal: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = bots.filter((bot) => `${bot.name} ${bot.handle}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="animate-rise">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><h2 className="text-2xl font-black tracking-[-.04em]">Meus bots</h2><p className="mt-2 text-sm text-[#878391]">Crie, pause e configure todos os bots da sua conta.</p></div>
        <Button onClick={() => setScreen("create")}><Plus size={17} /> Novo bot</Button>
      </div>
      <div className="glass mb-5 flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6e6a77]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="field h-11 min-h-0 pl-10" placeholder="Buscar por nome ou usuário..." /></div>
        <select className="field h-11 min-h-0 sm:w-40" defaultValue="all"><option value="all">Todos os status</option><option value="active">Ativos</option><option value="paused">Pausados</option><option value="draft">Rascunhos</option></select>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((bot) => (
          <BotCard
            key={bot.id}
            bot={bot}
            onManage={() => onManage(bot.id)}
            onStartLocal={() => onStartLocal(bot.id)}
            onRestartLocal={() => onRestartLocal(bot.id)}
            onStopLocal={() => onStopLocal(bot.id)}
            onDelete={() => onDelete(bot.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TelegramTokenGuide({ onOpenVideo }: { onOpenVideo: () => void }) {
  return (
    <details
      open
      className="group"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-black text-[#202124]">
        <span className="flex items-center gap-2">
          <CircleHelp size={19} className="text-[#1a73e8]" />
          Como obter o token do bot
        </span>
        <ChevronRight size={18} className="text-[#5f6368] transition group-open:rotate-90" />
      </summary>
      <div className="mt-5 space-y-4 text-[13px] leading-5 text-[#5f6368]">
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1a73e8] px-4 py-3 text-sm font-black text-white shadow-[0_8px_24px_rgba(26,115,232,.18)]"
        >
          Abrir BotFather <ArrowRight size={16} />
        </a>
        <button
          type="button"
          onClick={onOpenVideo}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#d2e3fc] bg-white px-4 py-3 text-sm font-black text-[#1a73e8] transition hover:bg-[#f8fbff]"
        >
          <CirclePlay size={17} />
          Ver vídeo tutorial
        </button>

        <ol className="space-y-4">
          <li className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-black text-[#1a73e8]">
              1
            </span>
            <div>
              <h4 className="font-black text-[#202124]">Abra o BotFather</h4>
              <p className="mt-1">
                Clique no botão para abrir o <strong>BotFather</strong> no
                Telegram.
              </p>
              <p className="mt-1">
                Na primeira vez, toque em <strong>Start</strong> e depois em{" "}
                <strong>Open</strong>.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-black text-[#1a73e8]">
              2
            </span>
            <div>
              <h4 className="font-black text-[#202124]">Crie um novo bot</h4>
              <p className="mt-1">
                Toque em <strong>Create a New Bot</strong>.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-black text-[#1a73e8]">
              3
            </span>
            <div>
              <h4 className="font-black text-[#202124]">Preencha os dados</h4>
              <p className="mt-1">Adicione uma foto e informe:</p>
              <ul className="mt-2 space-y-1">
                <li>
                  <strong>Bot Name:</strong> pode ser qualquer nome.
                </li>
                <li>
                  <strong>Username:</strong> deve ser único e terminar em{" "}
                  <code className="rounded bg-[#f1f3f4] px-1 py-0.5 text-[#202124]">
                    bot
                  </code>{" "}
                  ou{" "}
                  <code className="rounded bg-[#f1f3f4] px-1 py-0.5 text-[#202124]">
                    _bot
                  </code>
                  .
                </li>
              </ul>
              <p className="mt-2">
                Exemplo:{" "}
                <code className="rounded bg-[#f1f3f4] px-1.5 py-1 font-bold text-[#202124]">
                  minhaloja_bot
                </code>
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-black text-[#1a73e8]">
              4
            </span>
            <div>
              <h4 className="font-black text-[#202124]">Crie o bot</h4>
              <p className="mt-1">
                Toque em <strong>Create Bot</strong>.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e8f0fe] text-xs font-black text-[#1a73e8]">
              5
            </span>
            <div>
              <h4 className="font-black text-[#202124]">Copie o token</h4>
              <p className="mt-1">
                Na tela do bot criado, toque em <strong>Copy</strong>.
              </p>
              <p className="mt-1">
                Depois, volte ao site e cole o token no campo indicado.
              </p>
            </div>
          </li>
        </ol>

      </div>
    </details>
  );
}

function VideoTutorialModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-tutorial-title"
        className="w-full max-w-2xl overflow-hidden rounded-[28px] bg-white shadow-[0_30px_100px_rgba(32,33,36,.24)]"
      >
        <div className="flex items-center justify-between border-b border-[#e3e1dd] px-5 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-[#1a73e8]">
              Tutorial
            </p>
            <h3
              id="video-tutorial-title"
              className="mt-1 text-lg font-black tracking-[-.03em] text-[#202124]"
            >
              Como pegar o token no BotFather
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 place-items-center rounded-full bg-[#f1f3f4] text-[#5f6368] transition hover:bg-[#e8eaed] hover:text-[#202124]"
            aria-label="Fechar tutorial"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <div className="grid aspect-video place-items-center rounded-3xl border border-dashed border-[#d2e3fc] bg-[#f8fbff] text-center">
            <div className="px-6">
              <div className="mx-auto grid size-16 place-items-center rounded-full bg-[#e8f0fe] text-[#1a73e8]">
                <Video size={28} />
              </div>
              <p className="mt-4 text-base font-black text-[#202124]">
                Vídeo tutorial em breve
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#5f6368]">
                Aqui ficará o vídeo mostrando o passo a passo para criar o bot e
                copiar o token.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type TelegramWizardForm = {
  token: string;
  description: string;
  personality: string;
  tone: string;
  welcomeMessage: string;
  buyButtonLabel: string;
  welcomeMediaType: TelegramWelcomeMedia["type"];
  welcomeMediaUrl: string;
  firstPlanInterval: TelegramPlanInterval;
  firstPlanMessage: string;
  firstPlanButtonLabel: string;
  language: "pt-BR" | "en";
  moderationEnabled: boolean;
  spamProtection: boolean;
  watermark: boolean;
};

const defaultTelegramWizardForm: TelegramWizardForm = {
  token: "",
  description: "",
  personality: "Atencioso, claro e pronto para vender com naturalidade",
  tone: "Casual",
  welcomeMessage:
    "Olá, {nome}! Seja bem-vindo. Toque no botão abaixo para ver as opções disponíveis.",
  buyButtonLabel: "Ver ofertas",
  welcomeMediaType: "none",
  welcomeMediaUrl: "",
  firstPlanInterval: "monthly",
  firstPlanMessage:
    "Plano mensal com acesso ao VIP, conteúdos exclusivos e entrada liberada assim que o pagamento estiver ativo.",
  firstPlanButtonLabel: "Assinar plano mensal",
  language: "pt-BR",
  moderationEnabled: true,
  spamProtection: true,
  watermark: true,
};

const telegramPlanOptions: Array<{
  value: TelegramPlanInterval;
  label: string;
  helper: string;
  durationDays: number | null;
}> = [
  { value: "weekly", label: "Semanal", helper: "7 dias", durationDays: 7 },
  { value: "biweekly", label: "Quinzenal", helper: "15 dias", durationDays: 15 },
  { value: "monthly", label: "Mensal", helper: "30 dias", durationDays: 30 },
  { value: "quarterly", label: "Trimestral", helper: "90 dias", durationDays: 90 },
  { value: "yearly", label: "Anual", helper: "365 dias", durationDays: 365 },
  {
    value: "lifetime",
    label: "Vitalício",
    helper: "Acesso permanente",
    durationDays: null,
  },
];

function getTelegramPlanOption(value: TelegramPlanInterval) {
  return (
    telegramPlanOptions.find((option) => option.value === value) ??
    telegramPlanOptions[2]
  );
}

function isValidPublicMediaUrl(value: string) {
  if (!value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function TelegramIdentityCard({
  preview,
  compact = false,
}: {
  preview: TelegramBotPreview;
  compact?: boolean;
}) {
  const imageSize = compact ? 48 : 72;

  return (
    <div className="rounded-3xl border border-[#d2e3fc] bg-gradient-to-br from-[#f8fbff] to-[#e8f0fe] p-5">
      <div className="flex items-center gap-4">
        {preview.avatarDataUrl ? (
          <Image
            src={preview.avatarDataUrl}
            alt={`Foto de ${preview.name}`}
            width={imageSize}
            height={imageSize}
            unoptimized
            className={`shrink-0 rounded-full object-cover ring-4 ring-white ${
              compact ? "size-12" : "size-[72px]"
            }`}
          />
        ) : (
          <div
            className={`grid shrink-0 place-items-center rounded-full bg-[#1a73e8] text-white ring-4 ring-white ${
              compact ? "size-12" : "size-[72px]"
            }`}
          >
            <Bot size={compact ? 22 : 30} />
          </div>
        )}
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <p
              className={`truncate font-black text-[#202124] ${
                compact ? "text-base" : "text-lg"
              }`}
            >
              {preview.name}
            </p>
            <span className="rounded-full bg-[#1a73e8] px-2 py-0.5 text-[10px] font-black text-white">
              OK
            </span>
          </div>
          <p className="truncate text-sm font-bold text-[#1a73e8]">
            {preview.username}
          </p>
          {!compact && (
            <p className="mt-2 text-xs text-[#5f6368]">
              Bot identificado pelo token
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TelegramUserIdentityCard({
  user,
  compact = false,
}: {
  user: TelegramUserPreview;
  compact?: boolean;
}) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const imageSize = compact ? 48 : 64;

  return (
    <div className="rounded-3xl border border-[#c4eed0] bg-[#f2fbf5] p-5">
      <div className="flex items-center gap-4">
        {user.avatarDataUrl ? (
          <Image
            src={user.avatarDataUrl}
            alt={`Foto de ${fullName}`}
            width={imageSize}
            height={imageSize}
            unoptimized
            className={`shrink-0 rounded-full object-cover ring-4 ring-white ${
              compact ? "size-12" : "size-16"
            }`}
          />
        ) : (
          <div
            className={`grid shrink-0 place-items-center rounded-full bg-[#188038] text-white ring-4 ring-white ${
              compact ? "size-12" : "size-16"
            }`}
          >
            <UserRound size={compact ? 22 : 28} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-black text-[#202124]">
              {fullName}
            </p>
            <span className="rounded-full bg-[#188038] px-2 py-0.5 text-[10px] font-black text-white">
              VINCULADO
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-bold text-[#188038]">
            {user.username ? `@${user.username}` : `ID ${user.id}`}
          </p>
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5f6368]">
              <span>ID: {user.id}</span>
              {user.languageCode && (
                <span>Idioma: {user.languageCode.toUpperCase()}</span>
              )}
              {user.isPremium && <span>Telegram Premium</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getVipCommunityTypeLabel(type: TelegramVipCommunity["type"]) {
  if (type === "channel") return "Canal VIP";
  if (type === "supergroup") return "Grupo VIP";
  return "Grupo VIP";
}

function VipCommunityIdentityCard({
  community,
  compact = false,
}: {
  community: TelegramVipCommunity;
  compact?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-[#c4eed0] bg-[#f2fbf5] p-5">
      <div className="flex items-center gap-4">
        <div
          className={`grid shrink-0 place-items-center rounded-full bg-[#188038] text-white ring-4 ring-white ${
            compact ? "size-12" : "size-16"
          }`}
        >
          <Users size={compact ? 22 : 28} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-black text-[#202124]">
              Grupo ou canal VIP verificado
            </p>
            <span className="rounded-full bg-[#188038] px-2 py-0.5 text-[10px] font-black text-white">
              ADMIN OK
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-bold text-[#188038]">
            Bot confirmado como administrador
          </p>
          {!compact && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5f6368]">
              <span>{getVipCommunityTypeLabel(community.type)}</span>
              <span>Status: {community.botStatus}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VipTutorialStep({
  number,
  title,
  status,
  children,
}: {
  number: number;
  title: string;
  status: "done" | "active" | "locked";
  children: React.ReactNode;
}) {
  return (
    <details
      open={status !== "locked"}
      className={`group rounded-none border bg-white p-0 shadow-[0_1px_4px_rgba(60,64,67,.12)] ${
        status === "locked"
          ? "border-[#e3e1dd] opacity-55"
          : "border-[#e3e1dd]"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
        <span
          className={`grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs font-black ${
            status === "done"
              ? "border-[#1a73e8] bg-[#1a73e8] text-white"
              : status === "active"
                ? "border-[#2d2ca0] text-[#2d2ca0]"
                : "border-[#8f95a3] text-[#8f95a3]"
          }`}
        >
          {status === "done" ? <Check size={14} /> : number}
        </span>
        <p className="text-base font-black text-[#202124]">{title}</p>
        <ChevronRight className="ml-auto rotate-90 text-[#5f6368] transition group-open:-rotate-90" size={18} />
      </summary>
      <div className="px-6 pb-5 text-[15px] leading-7 text-[#202124]">
        {children}
      </div>
    </details>
  );
}

function VipCommunityGuide({
  botUsername,
  communityDetected,
  adminReady,
}: {
  botUsername?: string;
  communityDetected: boolean;
  adminReady: boolean;
}) {
  const username = botUsername || "@nomedoseubot";

  return (
    <div className="space-y-3">
      <VipTutorialStep
        number={1}
        title="Crie o grupo no Telegram, caso não tenha"
        status="active"
      >
        <p>
          Se ainda não tiver um grupo criado, abra o Telegram e crie um novo
          Grupo, Comunidade ou Canal.
        </p>
        <p className="mt-4">
          ⚠️ O grupo ou canal deve ser novo no CriaBot, sem nenhum cadastro
          anterior como comunidade principal ou grupo adicional.
        </p>
        <p className="mt-4">
          ⚠️ O grupo ou canal deve ser do tipo privado. Acesse as configurações
          do grupo e confirme essa opção em “Tipo de Grupo”.
        </p>
      </VipTutorialStep>

      <VipTutorialStep
        number={2}
        title="Adicione o bot ao grupo"
        status={communityDetected ? "done" : "active"}
      >
        <ol className="list-decimal space-y-1 pl-5">
          <li>Toque no nome do grupo para abrir as configurações.</li>
          <li>Vá até “Adicionar membros”.</li>
          <li>
            Pesquise pelo <strong>{username}</strong>, o nome que você criou no
            BotFather.
          </li>
          <li>Selecione o bot e adicione ao grupo normalmente.</li>
        </ol>
        <p className="mt-4">
          ⚠️ Caso o grupo não tenha sido detectado, remova o bot e adicione
          novamente.
        </p>
      </VipTutorialStep>

      <VipTutorialStep
        number={3}
        title="Torne o bot um administrador"
        status={adminReady ? "done" : communityDetected ? "active" : "locked"}
      >
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Ainda nas configurações do grupo, vá até a seção “Administradores”.
          </li>
          <li>
            Encontre o bot na lista de membros e toque em “Promover a
            administrador”.
          </li>
          <li>Ative as permissões de convidar usuários e gerenciar o grupo.</li>
        </ol>
      </VipTutorialStep>

      <VipTutorialStep
        number={4}
        title="Verifique no CriaBot"
        status={adminReady ? "done" : communityDetected ? "active" : "locked"}
      >
        <p>
          Volte para esta tela e clique em <strong>Verificar grupo/canal</strong>.
          O passo 3 só libera quando o bot estiver como administrador.
        </p>
      </VipTutorialStep>
    </div>
  );
}

function CreateTelegramBot({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: TelegramBotSetupInput) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [showToken, setShowToken] = useState(false);
  const [videoTutorialOpen, setVideoTutorialOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedOwnership, setAcceptedOwnership] = useState(false);
  const [telegramPreview, setTelegramPreview] =
    useState<TelegramBotPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [accountLink, setAccountLink] = useState<TelegramAccountLinkState>({
    status: "not_started",
    user: null,
  });
  const [accountLinkLoading, setAccountLinkLoading] = useState(false);
  const [accountLinkError, setAccountLinkError] = useState<string | null>(null);
  const [preparedToken, setPreparedToken] = useState("");
  const [botPrepareState, setBotPrepareState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [botPrepareMessage, setBotPrepareMessage] = useState("");
  const [vipCommunityVerification, setVipCommunityVerification] =
    useState<TelegramVipCommunityVerification | null>(null);
  const [vipCommunityVerifying, setVipCommunityVerifying] = useState(false);
  const [vipCommunityError, setVipCommunityError] = useState<string | null>(
    null,
  );
  const [form, setForm] = useState<TelegramWizardForm>(
    defaultTelegramWizardForm,
  );
  const updateToken = (token: string) => {
    setError(null);
    setAcceptedOwnership(false);
    setTelegramPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setPreparedToken("");
    setBotPrepareState("idle");
    setBotPrepareMessage("");
    setVipCommunityVerification(null);
    setVipCommunityError(null);
    setForm((current) => ({ ...current, token }));
  };
  const update = <Key extends keyof TelegramWizardForm>(
    field: Key,
    value: TelegramWizardForm[Key],
  ) => {
    setError(null);
    setForm((current) => ({ ...current, [field]: value }));
  };
  const telegramReady =
    isValidTelegramToken(form.token) && telegramPreview !== null;
  const telegramAccountLinked =
    accountLink.status === "linked" && accountLink.user !== null;
  const vipCommunityReady =
    vipCommunityVerification?.ready === true &&
    vipCommunityVerification.community?.botIsAdmin === true;
  const step2Ready = vipCommunityReady;
  const selectedPlan = getTelegramPlanOption(form.firstPlanInterval);
  const firstPlan: TelegramFirstPlan = {
    interval: selectedPlan.value,
    label: selectedPlan.label,
    durationDays: selectedPlan.durationDays,
    message: form.firstPlanMessage.trim(),
    buttonLabel: form.firstPlanButtonLabel.trim(),
    paymentEnabled: false,
  };
  const welcomeMedia: TelegramWelcomeMedia = {
    type: form.welcomeMediaType,
    url: form.welcomeMediaType === "none" ? "" : form.welcomeMediaUrl.trim(),
  };
  const welcomeMediaReady =
    welcomeMedia.type === "none" || isValidPublicMediaUrl(welcomeMedia.url);
  const step3Ready =
    form.welcomeMessage.trim().length >= 8 &&
    welcomeMediaReady &&
    firstPlan.message.length >= 8 &&
    firstPlan.buttonLabel.length >= 2;
  const canContinue =
    step === 1
      ? telegramReady && telegramAccountLinked
      : step === 2
        ? step2Ready
        : step === 3
          ? step3Ready
          : acceptedOwnership;
  const wizardDirty =
    step > 1 ||
    acceptedOwnership ||
    form.token.trim().length > 0 ||
    Boolean(vipCommunityVerification?.community) ||
    form.description.trim().length > 0 ||
    form.personality !== defaultTelegramWizardForm.personality ||
    form.tone !== defaultTelegramWizardForm.tone ||
    form.welcomeMessage !== defaultTelegramWizardForm.welcomeMessage ||
    form.buyButtonLabel !== defaultTelegramWizardForm.buyButtonLabel ||
    form.welcomeMediaType !== defaultTelegramWizardForm.welcomeMediaType ||
    form.welcomeMediaUrl !== defaultTelegramWizardForm.welcomeMediaUrl ||
    form.firstPlanInterval !== defaultTelegramWizardForm.firstPlanInterval ||
    form.firstPlanMessage !== defaultTelegramWizardForm.firstPlanMessage ||
    form.firstPlanButtonLabel !==
      defaultTelegramWizardForm.firstPlanButtonLabel ||
    form.language !== defaultTelegramWizardForm.language ||
    form.watermark !== defaultTelegramWizardForm.watermark;
  const setupSteps = [
    "Conectar Telegram",
    "Grupo VIP",
    "Plano inicial",
    "Revisar e criar",
  ];

  function cancelWizard() {
    if (
      wizardDirty &&
      !window.confirm("Deseja sair da criação do bot? As informações serão apagadas.")
    ) {
      return;
    }
    onCancel();
  }

  useEffect(() => {
    const controller = new AbortController();
    void getTelegramAccountLinkStatus(controller.signal)
      .then((state) => {
        setAccountLink(state);
        setAccountLinkError(null);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setAccountLinkError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível consultar o vínculo do Telegram.",
        );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (accountLink.status !== "pending") return;

    let active = true;
    const checkLink = async () => {
      try {
        const state = await getTelegramAccountLinkStatus();
        if (!active) return;
        setAccountLink(state);
        setAccountLinkError(null);
      } catch (caught) {
        if (!active) return;
        setAccountLinkError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível verificar o Telegram.",
        );
      }
    };

    const timer = window.setInterval(() => void checkLink(), 2500);
    void checkLink();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accountLink.status]);

  useEffect(() => {
    if (!wizardDirty) return;
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeExit);
    return () => window.removeEventListener("beforeunload", warnBeforeExit);
  }, [wizardDirty]);

  useEffect(() => {
    const token = form.token.trim();
    if (!isValidTelegramToken(token)) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const preview = await previewTelegramBot(token, controller.signal);
        setTelegramPreview(preview);
      } catch (caught) {
        if (
          caught instanceof DOMException &&
          caught.name === "AbortError"
        ) {
          return;
        }
        setTelegramPreview(null);
        setPreviewError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível identificar o bot.",
        );
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 550);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.token]);

  async function linkTelegramAccount() {
    setAccountLinkLoading(true);
    setAccountLinkError(null);
    try {
      const state = await startTelegramAccountLink();
      setAccountLink(state);
      if (state.url) {
        window.open(state.url, "_blank", "noopener,noreferrer");
      }
    } catch (caught) {
      setAccountLinkError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível abrir o bot oficial do CriaBot.",
      );
    } finally {
      setAccountLinkLoading(false);
    }
  }

  async function prepareCurrentTelegramBot() {
    const token = form.token.trim();
    if (preparedToken === token && botPrepareState === "ready") return;

    setPreparedToken(token);
    setBotPrepareState("loading");
    setBotPrepareMessage("Colocando o bot online para verificar o VIP...");
    setVipCommunityError(null);

    try {
      const state = await prepareTelegramBotForVip(token);
      setBotPrepareState("ready");
      setBotPrepareMessage(state.message);
    } catch (caught) {
      setBotPrepareState("error");
      setBotPrepareMessage(
        caught instanceof Error
          ? caught.message
          : "Não foi possível deixar o bot online para verificação.",
      );
    }
  }

  async function continueWizard() {
    if (step === 1) {
      setStep(2);
      await prepareCurrentTelegramBot();
      return;
    }

    setStep((value) => value + 1);
  }

  async function verifyVipCommunity() {
    if (!telegramReady) {
      setVipCommunityError("Valide o token do bot antes de verificar o VIP.");
      return;
    }
    setVipCommunityVerifying(true);
    setVipCommunityError(null);
    try {
      const state = await verifyTelegramVipCommunity({
        token: form.token.trim(),
      });
      setVipCommunityVerification(state);
      if (!state.ready) {
        setVipCommunityError(state.message);
      }
    } catch (caught) {
      setVipCommunityVerification(null);
      setVipCommunityError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível verificar o grupo ou canal.",
      );
    } finally {
      setVipCommunityVerifying(false);
    }
  }

  async function finish() {
    if (!acceptedOwnership) {
      setError("Confirme que você é dono deste bot para continuar.");
      return;
    }
    const vipCommunity = vipCommunityVerification?.community;
    if (!vipCommunityReady || !vipCommunity) {
      setError("Confirme o grupo ou canal VIP com o bot como administrador.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onCreate({
        token: form.token.trim(),
        description: form.description.trim(),
        personality: form.personality.trim(),
        tone: form.tone,
        welcomeMessage: form.welcomeMessage.trim(),
        buyButtonLabel: firstPlan.buttonLabel,
        language: form.language,
        moderationEnabled: form.moderationEnabled,
        spamProtection: form.spamProtection,
        watermark: form.watermark,
        vipCommunity,
        firstPlan,
        welcomeMedia,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível conectar o bot Telegram.",
      );
    } finally {
      setLoading(false);
    }
  }

  const welcomePreview = form.welcomeMessage
    .replaceAll("{nome}", "João")
    .trim();

  return (
    <div className="mx-auto max-w-6xl animate-rise">
      <div>
        <div className="grid gap-7 lg:grid-cols-[1.08fr_.92fr] lg:gap-0">
          <div className="lg:pr-12">
            <div className="mb-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-[.12em] text-[#1a73e8]">
                  Passo {step} de 4
                </p>
                <p className="text-sm font-extrabold text-[#202124]">
                  {setupSteps[step - 1]}
                </p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {setupSteps.map((label, index) => {
                  const number = index + 1;
                  const current = number === step;
                  const completed = number < step;
                  return (
                    <div key={label}>
                      <div
                        className={`h-1.5 rounded-full transition ${
                          number <= step ? "bg-[#1a73e8]" : "bg-[#e3e1dd]"
                        }`}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                            current
                              ? "bg-[#1a73e8] text-white"
                              : completed
                                ? "bg-[#e8f0fe] text-[#1a73e8]"
                                : "bg-[#f1f3f4] text-[#80868b]"
                          }`}
                        >
                          {completed ? <Check size={13} /> : number}
                        </span>
                        <span
                          className={`hidden text-[11px] font-bold sm:block ${
                            number <= step
                              ? "text-[#202124]"
                              : "text-[#80868b]"
                          }`}
                        >
                          {label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {step === 1 && (
              <div className="space-y-6">
                <label className="block">
                  <span className="mb-2.5 block text-base font-extrabold text-[#202124]">
                    Token do BotFather
                  </span>
                  <div className="relative">
                    <input
                      className={`field pr-12 ${
                        form.token && !isValidTelegramToken(form.token)
                          ? "border-[#ffbd59]/60"
                          : ""
                      } ${showToken ? "" : "token-masked"}`}
                      value={form.token}
                      onChange={(event) => updateToken(event.target.value)}
                      type="text"
                      placeholder="Cole aqui o token enviado pelo BotFather"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      name="telegram-bot-token"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-[#5f6368] hover:text-[#1a73e8]"
                      aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                    >
                      {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>

                {previewLoading && (
                  <div className="flex items-center gap-3 rounded-2xl border border-[#d2e3fc] bg-[#f8fbff] p-4 text-sm font-bold text-[#5f6368]">
                    <div className="size-5 animate-spin rounded-full border-2 border-[#d2e3fc] border-t-[#1a73e8]" />
                    Identificando o bot no Telegram...
                  </div>
                )}
                {previewError && (
                  <div className="flex items-start gap-2 rounded-2xl border border-[#ff5c7a]/20 bg-[#ff5c7a]/[.07] p-4 text-sm leading-6 text-[#b3261e]">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    {previewError}
                  </div>
                )}
                {telegramPreview && (
                  <TelegramIdentityCard preview={telegramPreview} />
                )}

                {telegramAccountLinked && accountLink.user ? (
                  <TelegramUserIdentityCard user={accountLink.user} />
                ) : (
                  <div className="rounded-3xl border border-[#d2e3fc] bg-[#f8fbff] p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Send size={18} className="text-[#1a73e8]" />
                          <p className="font-black text-[#202124]">
                            Vincule sua conta do Telegram
                          </p>
                        </div>
                        <p className="mt-1.5 text-sm leading-6 text-[#5f6368]">
                          Abra o bot oficial, toque em Start e volte ao painel.
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={() => void linkTelegramAccount()}
                        disabled={accountLinkLoading}
                        className="shrink-0"
                      >
                        {accountLinkLoading ? (
                          <>
                            <div className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                            Abrindo...
                          </>
                        ) : (
                          <>
                            <Send size={16} />
                            {accountLink.status === "pending"
                              ? "Abrir Telegram"
                              : "Vincular Telegram"}
                          </>
                        )}
                      </Button>
                    </div>

                    {accountLink.status === "pending" && (
                      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#d2e3fc] bg-white p-3 text-sm font-bold text-[#174ea6]">
                        <div className="size-4 animate-spin rounded-full border-2 border-[#d2e3fc] border-t-[#1a73e8]" />
                        Aguardando sua confirmação no Telegram...
                      </div>
                    )}
                    {accountLink.status === "expired" && (
                      <p className="mt-4 text-sm font-bold text-[#b06000]">
                        O link expirou. Clique em Vincular Telegram para gerar
                        outro.
                      </p>
                    )}
                    {accountLinkError && (
                      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[#ff5c7a]/20 bg-[#ff5c7a]/[.07] p-3 text-sm leading-6 text-[#b3261e]">
                        <AlertCircle size={17} className="mt-0.5 shrink-0" />
                        {accountLinkError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black tracking-[-.04em] text-[#202124]">
                    Grupo VIP
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#5f6368]">
                    Adicione o bot ao grupo ou canal e confirme a verificação
                    automática.
                  </p>
                </div>

                <div
                  className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${
                    botPrepareState === "ready"
                      ? "border-[#c4eed0] bg-[#f2fbf5] text-[#188038]"
                      : botPrepareState === "error"
                        ? "border-[#ff5c7a]/20 bg-[#ff5c7a]/[.07] text-[#b3261e]"
                        : "border-[#d2e3fc] bg-[#f8fbff] text-[#174ea6]"
                  }`}
                >
                  {botPrepareState === "loading" ? (
                    <div className="size-4 animate-spin rounded-full border-2 border-[#d2e3fc] border-t-[#1a73e8]" />
                  ) : botPrepareState === "ready" ? (
                    <Check size={18} />
                  ) : (
                    <CircleHelp size={18} />
                  )}
                  {botPrepareMessage ||
                    "Ao entrar neste passo, o bot fica online para verificar o grupo ou canal."}
                </div>

                <div className="rounded-3xl border border-[#e3e1dd] bg-white p-5 shadow-[0_18px_60px_rgba(60,64,67,.06)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-lg font-black tracking-[-.03em] text-[#202124]">
                        Grupo ou canal VIP
                      </h3>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-black ${
                        vipCommunityReady
                          ? "bg-[#e6f4ea] text-[#188038]"
                          : "bg-[#e8f0fe] text-[#1a73e8]"
                      }`}
                    >
                      {vipCommunityReady ? <Check size={15} /> : <Clock3 size={15} />}
                      {vipCommunityReady ? "VIP pronto" : "Aguardando admin"}
                    </span>
                  </div>

                  <div className="mt-5">
                    <Button
                      type="button"
                      onClick={() => void verifyVipCommunity()}
                      disabled={vipCommunityVerifying || !telegramReady}
                      className="w-full sm:w-auto"
                    >
                      {vipCommunityVerifying ? (
                        <>
                          <div className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                          Verificando...
                        </>
                      ) : (
                        <>
                          <Users size={16} />
                          Verificar automaticamente
                        </>
                      )}
                    </Button>
                  </div>

                  {vipCommunityVerification?.community && (
                    <div className="mt-5">
                      {vipCommunityReady ? (
                        <VipCommunityIdentityCard
                          community={vipCommunityVerification.community}
                        />
                      ) : (
                        <div className="rounded-3xl border border-[#ffbd59]/30 bg-[#fff8e8] p-5">
                          <h4 className="text-base font-black text-[#202124]">
                            Bot detectado
                          </h4>
                          <p className="mt-2 text-sm leading-6 text-[#3c4043]">
                            Detectamos que seu bot foi adicionado. Agora torne
                            o bot administrador e verifique novamente.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {vipCommunityError && (
                    <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[#ff5c7a]/20 bg-[#ff5c7a]/[.07] p-4 text-sm leading-6 text-[#b3261e]">
                      <AlertCircle size={18} className="mt-0.5 shrink-0" />
                      {vipCommunityError}
                    </div>
                  )}
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black tracking-[-.04em] text-[#202124]">
                    Mensagem e primeiro plano
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#5f6368]">
                    Configure a primeira mensagem do bot e o plano que aparece
                    no botão inicial. O pagamento será configurado depois.
                  </p>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#202124]">
                    Mensagem de boas-vindas
                  </span>
                  <textarea
                    className="field min-h-[112px] resize-none py-3"
                    value={form.welcomeMessage}
                    onChange={(event) =>
                      update("welcomeMessage", event.target.value)
                    }
                    maxLength={600}
                    placeholder="Ex.: Olá, {nome}! Seja bem-vindo ao VIP."
                  />
                  <span className="mt-1.5 flex items-center justify-between text-xs text-[#5f6368]">
                    <span>Use {"{nome}"} para chamar a pessoa pelo nome.</span>
                    <span>{form.welcomeMessage.length}/600</span>
                  </span>
                </label>

                <div className="rounded-3xl border border-[#e3e1dd] bg-white p-5 shadow-[0_18px_60px_rgba(60,64,67,.06)]">
                  <div>
                    <h3 className="text-lg font-black tracking-[-.03em] text-[#202124]">
                      Mídia da boas-vindas
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[#5f6368]">
                      Opcional: envie uma foto ou vídeo junto da mensagem
                      inicial. Use um link público para o Telegram conseguir
                      carregar a mídia.
                    </p>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { value: "none", label: "Sem mídia" },
                      { value: "photo", label: "Foto" },
                      { value: "video", label: "Vídeo" },
                    ].map((option) => {
                      const value = option.value as TelegramWelcomeMedia["type"];
                      const selected = form.welcomeMediaType === value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setError(null);
                            setForm((current) => ({
                              ...current,
                              welcomeMediaType: value,
                              welcomeMediaUrl:
                                value === "none" ? "" : current.welcomeMediaUrl,
                            }));
                          }}
                          className={`rounded-2xl border px-4 py-3 text-left text-sm font-black transition ${
                            selected
                              ? "border-[#1a73e8] bg-[#e8f0fe] text-[#174ea6]"
                              : "border-[#e3e1dd] bg-[#f8f7f4] text-[#5f6368] hover:border-[#d2e3fc]"
                          }`}
                        >
                          {selected ? "✓ " : ""}
                          {option.label}
                        </button>
                      );
                    })}
                  </div>

                  {form.welcomeMediaType !== "none" && (
                    <label className="mt-4 block">
                      <span className="mb-2 block text-sm font-black text-[#202124]">
                        URL pública da {form.welcomeMediaType === "photo" ? "foto" : "vídeo"}
                      </span>
                      <input
                        className={`field ${
                          form.welcomeMediaUrl &&
                          !isValidPublicMediaUrl(form.welcomeMediaUrl)
                            ? "border-[#ff5c7a]/50"
                            : ""
                        }`}
                        value={form.welcomeMediaUrl}
                        onChange={(event) =>
                          update("welcomeMediaUrl", event.target.value)
                        }
                        placeholder={
                          form.welcomeMediaType === "photo"
                            ? "https://exemplo.com/foto.jpg"
                            : "https://exemplo.com/video.mp4"
                        }
                      />
                      <span className="mt-1.5 block text-xs leading-5 text-[#5f6368]">
                        O link precisa começar com http:// ou https:// e estar
                        acessível publicamente.
                      </span>
                    </label>
                  )}
                </div>

                <div className="rounded-3xl border border-[#e3e1dd] bg-white p-5 shadow-[0_18px_60px_rgba(60,64,67,.06)]">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-lg font-black tracking-[-.03em] text-[#202124]">
                        Primeiro plano
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-[#5f6368]">
                        Escolha a duração e escreva a mensagem que será exibida
                        antes do pagamento ser configurado.
                      </p>
                    </div>
                    <span className="rounded-full bg-[#f1f3f4] px-3 py-1.5 text-xs font-black text-[#5f6368]">
                      Pagamento depois
                    </span>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {telegramPlanOptions.map((option) => {
                      const selected = option.value === form.firstPlanInterval;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            setError(null);
                            setForm((current) => ({
                              ...current,
                              firstPlanInterval: option.value,
                              firstPlanButtonLabel: `Assinar plano ${option.label.toLowerCase()}`,
                              firstPlanMessage:
                                option.value === "lifetime"
                                  ? "Acesso vitalício ao VIP, com entrada liberada assim que o pagamento estiver ativo."
                                  : `Plano ${option.label.toLowerCase()} com acesso ao VIP por ${option.helper.toLowerCase()}, conteúdos exclusivos e entrada liberada assim que o pagamento estiver ativo.`,
                            }));
                          }}
                          className={`rounded-2xl border p-4 text-left transition ${
                            selected
                              ? "border-[#1a73e8] bg-[#e8f0fe] shadow-[0_12px_30px_rgba(26,115,232,.14)]"
                              : "border-[#e3e1dd] bg-[#f8f7f4] hover:border-[#d2e3fc] hover:bg-[#f8fbff]"
                          }`}
                        >
                          <span
                            className={`grid size-7 place-items-center rounded-full text-xs font-black ${
                              selected
                                ? "bg-[#1a73e8] text-white"
                                : "bg-white text-[#5f6368]"
                            }`}
                          >
                            {selected ? <Check size={15} /> : "+"}
                          </span>
                          <span className="mt-3 block text-base font-black text-[#202124]">
                            {option.label}
                          </span>
                          <span className="mt-1 block text-sm font-bold text-[#5f6368]">
                            {option.helper}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <label className="mt-5 block">
                    <span className="mb-2 block text-sm font-black text-[#202124]">
                      Mensagem do plano
                    </span>
                    <textarea
                      className="field min-h-[104px] resize-none py-3"
                      value={form.firstPlanMessage}
                      onChange={(event) =>
                        update("firstPlanMessage", event.target.value)
                      }
                      maxLength={600}
                      placeholder="Explique o que o cliente recebe ao escolher esse plano."
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="mb-2 block text-sm font-black text-[#202124]">
                      Texto do botão do plano
                    </span>
                    <input
                      className="field"
                      value={form.firstPlanButtonLabel}
                      onChange={(event) =>
                        update("firstPlanButtonLabel", event.target.value)
                      }
                      maxLength={40}
                      placeholder="Ex.: Assinar plano mensal"
                    />
                  </label>

                  <div className="mt-5 rounded-2xl border border-[#d2e3fc] bg-[#f8fbff] p-4 text-sm leading-6 text-[#174ea6]">
                    No Telegram, o botão do plano já fica funcional. Enquanto o
                    pagamento não estiver configurado, ao clicar nele o bot
                    responde: “pagamento ainda não configurado”.
                  </div>
                </div>

                {!step3Ready && (
                  <p className="rounded-2xl border border-[#ffbd59]/30 bg-[#fff8e8] p-4 text-xs font-bold leading-5 text-[#b06000]">
                    Preencha a mensagem, a mídia opcional, o plano e o texto do
                    botão para continuar.
                  </p>
                )}
              </div>
            )}
            {step === 4 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black tracking-[-.04em] text-[#202124]">
                    Revise antes de criar
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#5f6368]">
                    Se estiver tudo certo, criaremos o bot no painel e deixaremos
                    a conexão preparada.
                  </p>
                </div>

                {telegramPreview && (
                  <TelegramIdentityCard preview={telegramPreview} compact />
                )}
                {accountLink.user && (
                  <TelegramUserIdentityCard
                    user={accountLink.user}
                    compact
                  />
                )}
                {vipCommunityVerification?.community && (
                  <VipCommunityIdentityCard
                    community={vipCommunityVerification.community}
                    compact
                  />
                )}

                <div className="rounded-3xl border border-[#e3e1dd] bg-[#f8f7f4] p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[.12em] text-[#5f6368]">
                        Boas-vindas
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[#202124]">
                        {form.welcomeMessage}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[.12em] text-[#5f6368]">
                        Mídia
                      </p>
                      <p className="mt-2 text-sm font-bold text-[#202124]">
                        {welcomeMedia.type === "none"
                          ? "Sem mídia"
                          : welcomeMedia.type === "photo"
                            ? "Foto na boas-vindas"
                            : "Vídeo na boas-vindas"}
                      </p>
                      {welcomeMedia.url && (
                        <p className="mt-1 break-all text-xs leading-5 text-[#5f6368]">
                          {welcomeMedia.url}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[.12em] text-[#5f6368]">
                        Plano
                      </p>
                      <p className="mt-2 text-sm font-bold text-[#202124]">
                        {selectedPlan.label} · {selectedPlan.helper}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[.12em] text-[#5f6368]">
                        Botão do plano
                      </p>
                      <p className="mt-2 inline-flex rounded-full bg-[#1a73e8] px-4 py-2 text-sm font-black text-white">
                        {firstPlan.buttonLabel}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[.12em] text-[#5f6368]">
                        Mensagem do plano
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[#202124]">
                        {firstPlan.message}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-[#d2e3fc] bg-[#f8fbff] p-4 text-sm leading-6 text-[#174ea6]">
                  <Clock3 size={18} className="mt-0.5 shrink-0" />
                  O plano inicial ficará pronto no bot, mas a cobrança será
                  configurada em uma próxima etapa do painel.
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Conteúdo seguro", icon: ShieldCheck },
                    { label: "Anti-spam ativo", icon: MessageCircle },
                    { label: "Registro de ações", icon: FileText },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.label}
                        className="flex items-center gap-2 rounded-2xl border border-[#d2e3fc] bg-[#f8fbff] px-3 py-3 text-xs font-black text-[#1a73e8]"
                      >
                        <Icon size={16} />
                        {item.label}
                      </div>
                    );
                  })}
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#e3e1dd] bg-white p-4 text-sm leading-6 text-[#3c4043]">
                  <input
                    type="checkbox"
                    checked={acceptedOwnership}
                    onChange={(event) =>
                      setAcceptedOwnership(event.target.checked)
                    }
                    className="mt-1 accent-[#1a73e8]"
                  />
                  <span>
                    Confirmo que sou dono deste bot e que ele será usado conforme
                    os Termos do CriaBot.
                  </span>
                </label>

                {error && (
                  <div className="flex items-start gap-2 rounded-xl border border-[#ff5c7a]/20 bg-[#ff5c7a]/[.07] p-3 text-xs leading-5 text-[#b3261e]">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}
              </div>
            )}
            <div className="mt-6 flex items-center justify-between border-t border-[#e3e1dd] pt-5">
              <Button variant="ghost" onClick={cancelWizard} disabled={loading}>
                <ArrowLeft size={16} /> Cancelar
              </Button>
              {step > 1 && (
                <Button
                  variant="secondary"
                  onClick={() => setStep((value) => value - 1)}
                  disabled={loading}
                  className="ml-auto mr-3"
                >
                  Anterior
                </Button>
              )}
              {step < 4 ? (
                <Button
                  onClick={() => void continueWizard()}
                  disabled={!canContinue || loading}
                >
                  Continuar <ArrowRight size={16} />
                </Button>
              ) : (
                <Button
                  onClick={() => void finish()}
                  disabled={!canContinue || loading}
                >
                  {loading ? (
                    <>
                      <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Criando...
                    </>
                  ) : (
                    <>
                      <Rocket size={16} /> Criar bot
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
          <aside className="create-guide border-t p-5 sm:p-6 lg:border-l lg:border-t-0 lg:pl-10">
            {step === 1 ? (
              <TelegramTokenGuide
                onOpenVideo={() => setVideoTutorialOpen(true)}
              />
            ) : step === 2 ? (
              <VipCommunityGuide
                botUsername={telegramPreview?.username}
                communityDetected={Boolean(vipCommunityVerification?.community)}
                adminReady={vipCommunityReady}
              />
            ) : (
              <>
                <p className="text-[10px] font-black uppercase tracking-[.17em] text-[#5f6368]">
                  Prévia do cliente
                </p>
                <div className="mt-5 rounded-3xl border border-[#e3e1dd] bg-white p-4 shadow-[0_18px_60px_rgba(60,64,67,.08)]">
                  <div className="flex items-center gap-3 border-b border-[#e3e1dd] pb-4">
                    {telegramPreview?.avatarDataUrl ? (
                      <Image
                        src={telegramPreview.avatarDataUrl}
                        alt={`Foto de ${telegramPreview.name}`}
                        width={44}
                        height={44}
                        unoptimized
                        className="size-11 rounded-full object-cover"
                      />
                    ) : (
                      <div className="grid size-11 place-items-center rounded-full bg-[#1a73e8] text-white">
                        <Bot size={20} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-[#202124]">
                        {telegramPreview?.name || "Seu novo bot"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[#5f6368]">
                        {telegramPreview?.username || "@seubot"} · Telegram
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3 py-5">
                    {welcomeMedia.type !== "none" && (
                      <div className="grid max-w-[90%] place-items-center rounded-2xl rounded-tl-sm border border-[#d2e3fc] bg-[#f8fbff] p-4 text-center text-sm font-bold text-[#174ea6]">
                        {welcomeMedia.type === "photo"
                          ? "Foto da boas-vindas"
                          : "Vídeo da boas-vindas"}
                      </div>
                    )}
                    <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-[#f1f3f4] p-3 text-sm leading-6 text-[#3c4043]">
                      {welcomePreview ||
                        "Olá! Toque no botão abaixo para continuar."}
                    </div>
                    <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-[#f1f3f4] p-3 text-sm leading-6 text-[#3c4043]">
                      <p className="font-black text-[#202124]">
                        {selectedPlan.label} · {selectedPlan.helper}
                      </p>
                      <p className="mt-1">{firstPlan.message}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-xl bg-[#1a73e8] px-4 py-3 text-sm font-black text-white"
                    >
                      {firstPlan.buttonLabel || "Ver ofertas"}
                    </button>
                    <div className="ml-auto max-w-[72%] rounded-2xl rounded-tr-sm bg-[#e8f0fe] p-3 text-sm font-bold text-[#174ea6]">
                      Quero saber mais.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-[#e3e1dd] bg-[#f8f7f4] px-3 py-2.5 text-xs text-[#5f6368]">
                    Escreva uma mensagem...
                    <ArrowRight size={13} className="ml-auto" />
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
      {videoTutorialOpen && (
        <VideoTutorialModal onClose={() => setVideoTutorialOpen(false)} />
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CreateBot({ onCancel, onCreate }: { onCancel: () => void; onCreate: (bot: BotItem) => void }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    handle: "",
    description: "",
    personality: "Confiante, divertida e acolhedora",
    tone: "Casual",
    platform: "Telegram",
    moderationEnabled: true,
    spamProtection: true,
    watermark: true,
  });
  const update = (field: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }));

  function finish() {
    const slug = form.handle.replace("@", "").toLowerCase().replace(/[^a-z0-9]+/g, "-") || crypto.randomUUID().slice(0, 8);
    onCreate({
      id: slug,
      name: form.name || "Novo bot",
      handle: form.handle.startsWith("@") ? form.handle : `@${form.handle || slug}`,
      description: form.description || "Bot criado para relacionamento e distribuição de conteúdo.",
      personality: form.personality,
      tone: form.tone,
      welcomeMessage:
        "Olá, {nome}! Seja bem-vindo. Toque no botão abaixo para ver as opções disponíveis.",
      buyButtonLabel: "Ver ofertas",
      language: "pt-BR",
      platform: form.platform,
      status: "draft",
      messages: 0,
      audience: 0,
      createdAt: new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
        .format(new Date())
        .replace(".", ""),
      moderationEnabled: form.moderationEnabled,
      spamProtection: form.spamProtection,
      watermark: form.watermark,
    });
  }

  return (
    <div className="mx-auto max-w-4xl animate-rise">
      <button onClick={onCancel} className="mb-5 flex items-center gap-2 text-xs font-extrabold text-[#8b8794] hover:text-white"><ArrowLeft size={15} /> Voltar</button>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs font-extrabold text-[#c8ff4d]">ETAPA {step} DE 3</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-.04em] sm:text-3xl">
            {step === 1 && "Dê identidade ao seu bot"}{step === 2 && "Defina a personalidade"}{step === 3 && "Segurança e publicação"}
          </h2>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          {[1, 2, 3].map((item) => <div key={item} className={`h-1.5 rounded-full transition-all ${item === step ? "w-10 bg-[#c8ff4d]" : item < step ? "w-5 bg-[#7c5cff]" : "w-5 bg-white/10"}`} />)}
        </div>
      </div>
      <div className="glass overflow-hidden rounded-3xl">
        <div className="grid lg:grid-cols-[1.25fr_.75fr]">
          <div className="p-5 sm:p-8">
            {step === 1 && (
              <div className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <label><span className="mb-2 block text-xs font-extrabold text-[#b5b1bd]">Nome do bot</span><input className="field" value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Ex.: Minha assistente" /></label>
                  <label><span className="mb-2 block text-xs font-extrabold text-[#b5b1bd]">Usuário</span><input className="field" value={form.handle} onChange={(event) => update("handle", event.target.value)} placeholder="@seubot" /></label>
                </div>
                <label className="block"><span className="mb-2 block text-xs font-extrabold text-[#b5b1bd]">Canal inicial</span><select className="field" value={form.platform} onChange={(event) => update("platform", event.target.value)}><option>Telegram</option><option disabled>WhatsApp — em breve</option><option disabled>Web chat — em breve</option></select></label>
                <label className="block"><span className="mb-2 block text-xs font-extrabold text-[#b5b1bd]">Objetivo e descrição</span><textarea className="field" value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Explique o papel desse bot, o público e o tipo de atendimento..." /></label>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-5">
                <label className="block"><span className="mb-2 block text-xs font-extrabold text-[#b5b1bd]">Personalidade</span><textarea className="field" value={form.personality} onChange={(event) => update("personality", event.target.value)} placeholder="Como o bot deve se comportar?" /><span className="mt-2 block text-[10px] leading-4 text-[#716d7a]">Descreva traços, vocabulário, ritmo das respostas e o que deve ser evitado.</span></label>
                <label className="block">
                  <span className="mb-2 block text-xs font-extrabold text-[#b5b1bd]">Tom principal</span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {["Casual", "Elegante", "Divertido", "Direto"].map((tone) => <button type="button" key={tone} onClick={() => update("tone", tone)} className={`rounded-xl border px-3 py-3 text-xs font-extrabold transition ${form.tone === tone ? "border-[#c8ff4d]/40 bg-[#c8ff4d]/10 text-[#d8ff80]" : "border-white/[.07] bg-white/[.035] text-[#8f8b99] hover:bg-white/[.06]"}`}>{tone}</button>)}
                  </div>
                </label>
                <div className="rounded-2xl border border-[#7c5cff]/20 bg-[#7c5cff]/[.07] p-4">
                  <div className="flex gap-3"><Sparkles className="mt-0.5 shrink-0 text-[#a994ff]" size={17} /><div><p className="text-xs font-extrabold text-[#c9beff]">Automação inteligente na próxima fase</p><p className="mt-1 text-[11px] leading-5 text-[#888393]">Esta configuração será usada pelo bot-mestre para criar novas personas e fluxos automaticamente.</p></div></div>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3">
                {[
                  { key: "moderationEnabled" as const, icon: ShieldCheck, title: "Moderação de conteúdo", text: "Ajuda a bloquear mensagens abusivas, golpes e solicitações proibidas.", required: true },
                  { key: "spamProtection" as const, icon: MessageCircle, title: "Proteção anti-spam", text: "Limita abuso, mensagens repetidas e automações maliciosas.", required: true },
                  { key: "watermark" as const, icon: FileText, title: "Marca e rastreio", text: "Identifica materiais enviados pelo bot e registra a origem.", required: false },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.key} className="flex items-start gap-4 rounded-2xl border border-white/[.07] bg-white/[.03] p-4">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#c8ff4d]/10 text-[#c8ff4d]"><Icon size={18} /></div>
                      <div className="flex-1"><div className="flex items-center gap-2"><p className="text-xs font-extrabold">{item.title}</p>{item.required && <span className="rounded bg-white/[.06] px-1.5 py-0.5 text-[8px] font-black uppercase text-[#888491]">obrigatório</span>}</div><p className="mt-1 text-[10px] leading-5 text-[#7c7885]">{item.text}</p></div>
                      <Toggle checked={form[item.key]} onChange={() => { if (!item.required) update(item.key, !form[item.key]); }} label={item.title} />
                    </div>
                  );
                })}
                <div className="rounded-2xl border border-[#ffbd59]/20 bg-[#ffbd59]/[.055] p-4 text-[11px] leading-5 text-[#b8a98e]">O bot será criado como rascunho. Antes de publicar, conecte o token do canal e revise a mensagem inicial.</div>
              </div>
            )}
          </div>
          <aside className="border-t border-white/[.07] bg-black/10 p-5 lg:border-l lg:border-t-0 lg:p-7">
            <p className="text-[10px] font-black uppercase tracking-[.17em] text-[#65616e]">Prévia</p>
            <div className="mt-5 rounded-3xl border border-white/[.08] bg-[#0e0d13] p-4 shadow-2xl">
              <div className="flex items-center gap-3 border-b border-white/[.06] pb-4"><div className="grid size-10 place-items-center rounded-full bg-[#c8ff4d] text-black"><Bot size={19} /></div><div><p className="text-xs font-black">{form.name || "Seu novo bot"}</p><p className="mt-0.5 text-[9px] text-[#6f6b78]">{form.handle || "@seubot"} · bot</p></div></div>
              <div className="space-y-3 py-5">
                <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-white/[.065] p-3 text-[10px] leading-5 text-[#bbb7c2]">Olá! Eu sou {form.name || "seu novo bot"}. Como posso ajudar você hoje?</div>
                <div className="ml-auto max-w-[70%] rounded-2xl rounded-tr-sm bg-[#c8ff4d] p-3 text-[10px] font-bold text-[#16180f]">Quero conhecer os produtos.</div>
                <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-white/[.065] p-3 text-[10px] leading-5 text-[#bbb7c2]">Ótimo! Vou apresentar as melhores opções para você. ✨</div>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-white/[.06] bg-white/[.035] px-3 py-2.5 text-[9px] text-[#5f5b68]">Escreva uma mensagem...<ArrowRight size={13} className="ml-auto" /></div>
            </div>
          </aside>
        </div>
        <div className="flex items-center justify-between border-t border-white/[.07] p-5 sm:px-8">
          <Button variant="ghost" onClick={() => step === 1 ? onCancel() : setStep((value) => value - 1)}><ArrowLeft size={16} /> {step === 1 ? "Cancelar" : "Anterior"}</Button>
          {step < 3 ? <Button onClick={() => setStep((value) => value + 1)} disabled={step === 1 && (!form.name || !form.handle)}>Continuar <ArrowRight size={16} /></Button> : <Button onClick={finish}><Rocket size={16} /> Criar rascunho</Button>}
        </div>
      </div>
    </div>
  );
}

function ManageBot({ bot, onClose, onUpdate }: { bot: BotItem; onClose: () => void; onUpdate: (bot: BotItem) => void }) {
  const [draft, setDraft] = useState(bot);
  const [saved, setSaved] = useState(false);
  function save() {
    onUpdate(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }
  return (
    <div className="mx-auto max-w-5xl animate-rise">
      <button onClick={onClose} className="mb-5 flex items-center gap-2 text-xs font-extrabold text-[#8b8794] hover:text-white"><ArrowLeft size={15} /> Voltar aos bots</button>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-2xl bg-[#c8ff4d] text-black"><Bot size={26} /></div>
          <div><div className="flex items-center gap-2"><h2 className="text-xl font-black">{draft.name}</h2><StatusBadge status={draft.status} /></div><p className="mt-1 text-xs text-[#777382]">{draft.handle} · Criado em {draft.createdAt}</p></div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDraft((current) => ({ ...current, status: current.status === "active" ? "paused" : "active" }))}>{draft.status === "active" ? "Pausar bot" : "Ativar bot"}</Button>
          <Button onClick={save}>{saved ? <Check size={16} /> : <Settings size={16} />}{saved ? "Salvo" : "Salvar alterações"}</Button>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="glass rounded-2xl p-5 sm:p-7">
          <h3 className="mb-5 text-sm font-black">Identidade e comportamento</h3>
          <div className="grid gap-5 sm:grid-cols-2">
            <label><span className="mb-2 block text-xs font-extrabold text-[#aaa6b3]">Nome</span><input className="field" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label><span className="mb-2 block text-xs font-extrabold text-[#aaa6b3]">Usuário</span><div className="relative"><input className="field pr-11" value={draft.handle} readOnly /><Copy size={15} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#696572]" /></div></label>
          </div>
          <label className="mt-5 block"><span className="mb-2 block text-xs font-extrabold text-[#aaa6b3]">Descrição</span><textarea className="field" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="mt-5 block"><span className="mb-2 block text-xs font-extrabold text-[#aaa6b3]">Personalidade</span><textarea className="field" value={draft.personality} onChange={(event) => setDraft((current) => ({ ...current, personality: event.target.value }))} /></label>
        </div>
        <aside className="space-y-5">
          <div className="glass rounded-2xl p-5">
            <h3 className="text-sm font-black">Proteções</h3>
            <div className="mt-5 space-y-4">
              {([
                ["Moderação de conteúdo", "moderationEnabled", true],
                ["Proteção anti-spam", "spamProtection", true],
                ["Marca e rastreio", "watermark", false],
              ] as Array<[string, "moderationEnabled" | "spamProtection" | "watermark", boolean]>).map(([label, field, required]) => (
                <div key={String(field)} className="flex items-center justify-between">
                  <div><p className="text-xs font-extrabold">{label}</p><p className="mt-0.5 text-[9px] text-[#6d6976]">{required ? "Proteção obrigatória" : "Configuração opcional"}</p></div>
                  <Toggle checked={draft[field]} onChange={() => { if (!required) setDraft((current) => ({ ...current, [field]: !current[field] })); }} label={String(label)} />
                </div>
              ))}
            </div>
          </div>
          <div className="glass rounded-2xl p-5">
            <h3 className="text-sm font-black">Canal conectado</h3>
            <div className="mt-4 rounded-xl bg-white/[.035] p-3">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-xl bg-[#34a8e0]/10 text-[#51b9eb]"><MessageCircle size={17} /></div>
                <div>
                  <p className="text-xs font-extrabold">{draft.platform}</p>
                  <p className="mt-0.5 text-[9px] text-[#8f8b99]">
                    {draft.telegram?.username ?? draft.handle}
                  </p>
                </div>
                <ChevronRight size={15} className="ml-auto text-[#65616e]" />
              </div>
              <div className="mt-3">
                <ConnectionBadge bot={draft} />
              </div>
              {draft.telegram?.errorMessage && (
                <p className="mt-3 text-[10px] leading-5 text-[#ffc96f]">
                  {draft.telegram.errorMessage}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SettingsScreen({
  user,
  bots,
  onSaveProfile,
}: {
  user: AppUser;
  bots: BotItem[];
  onSaveProfile: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedBot, setSelectedBot] = useState(bots[0]?.id ?? "");

  async function saveProfile() {
    setSaving(true);
    try {
      await onSaveProfile(name);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-rise">
      <div className="mb-7">
        <h2 className="text-2xl font-black tracking-[-.04em]">Configurações</h2>
        <p className="mt-2 text-sm text-[#878391]">
          Gerencie sua conta, segurança e canais da operação.
        </p>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-5">
          <section className="glass rounded-2xl p-5 sm:p-7">
            <div className="mb-6 flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-[#7c5cff]/10 text-[#a994ff]">
                <UserRound size={19} />
              </div>
              <div>
                <h3 className="text-sm font-black">Sua conta</h3>
                <p className="mt-0.5 text-[10px] text-[#777382]">
                  Informações do administrador
                </p>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label>
                <span className="mb-2 block text-xs font-extrabold text-[#aaa6b3]">
                  Nome de exibição
                </span>
                <input
                  className="field"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                <span className="mb-2 block text-xs font-extrabold text-[#aaa6b3]">
                  E-mail
                </span>
                <input className="field opacity-65" value={user.email} readOnly />
              </label>
              <label>
                <span className="mb-2 block text-xs font-extrabold text-[#aaa6b3]">
                  Telefone
                </span>
                <input className="field opacity-65" value={user.phone} readOnly />
              </label>
            </div>
            <div className="mt-5 flex flex-col gap-3 border-t border-white/[.06] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-[11px] text-[#8b8794]">
                <ShieldCheck size={15} className="text-[#c8ff4d]" />
                Conta protegida por autenticação e políticas de acesso
              </div>
              <Button
                onClick={() => void saveProfile()}
                disabled={saving || name.trim().length < 2}
              >
                {saved ? <Check size={16} /> : <Settings size={16} />}
                {saving ? "Salvando..." : saved ? "Salvo" : "Salvar perfil"}
              </Button>
            </div>
          </section>

          <section className="glass rounded-2xl p-5 sm:p-7">
            <div className="mb-6 flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-[#34a8e0]/10 text-[#51b9eb]">
                <Send size={18} />
              </div>
              <div>
                <h3 className="text-sm font-black">Integração Telegram</h3>
                <p className="mt-0.5 text-[10px] text-[#777382]">
                  Preparação segura do canal
                </p>
              </div>
            </div>
            <label>
              <span className="mb-2 block text-xs font-extrabold text-[#aaa6b3]">
                Bot que receberá o canal
              </span>
              <select
                className="field"
                value={selectedBot}
                onChange={(event) => setSelectedBot(event.target.value)}
                disabled={!bots.length}
              >
                {!bots.length && <option value="">Crie um bot primeiro</option>}
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name} · {bot.handle}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
              <div className="flex items-start gap-3">
                <KeyRound size={17} className="mt-0.5 shrink-0 text-[#ffbd59]" />
                <div>
                  <p className="text-xs font-extrabold">Token protegido</p>
                  <p className="mt-1 text-[10px] leading-5 text-[#7c7885]">
                    Seu token é validado e protegido durante a conexão. Depois
                    disso, ele não aparece novamente no painel.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-[#7c5cff]/[.07] px-4 py-3">
              <div>
                <p className="text-xs font-extrabold text-[#c9beff]">
                  Canal pronto para configurar
                </p>
                <p className="mt-0.5 text-[9px] text-[#858091]">
                  Validação do token e webhook entram na fase seguinte.
                </p>
              </div>
              <span className="rounded-full bg-[#7c5cff]/15 px-2.5 py-1 text-[9px] font-black text-[#b8aaff]">
                PREPARADO
              </span>
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black">Proteção da conta</h3>
                <p className="mt-1 text-[10px] text-[#777382]">
                  Estado atual do ambiente
                </p>
              </div>
              <HardDrive
                size={19}
                className="text-[#c8ff4d]"
              />
            </div>
            <div className="mt-5 space-y-3">
              {[
                ["Acesso de contas", true],
                ["Dados protegidos", true],
                ["Sessão protegida", true],
                ["Proteções do painel", true],
              ].map(([label, active]) => (
                <div
                  key={String(label)}
                  className="flex items-center justify-between rounded-xl bg-white/[.03] px-3 py-3"
                >
                  <span className="text-[11px] font-bold text-[#aaa6b3]">
                    {label}
                  </span>
                  <span
                    className={`flex items-center gap-1.5 text-[9px] font-extrabold ${
                      active ? "text-[#c8ff4d]" : "text-[#6f6b78]"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        active ? "bg-[#c8ff4d]" : "bg-[#5d5966]"
                      }`}
                    />
                    {active ? "ATIVO" : "INATIVO"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[#c8ff4d]/15 bg-[#c8ff4d]/[.045] p-5">
            <h3 className="text-sm font-black text-[#d8ff80]">Ambiente conectado</h3>
            <p className="mt-2 text-[10px] leading-5 text-[#90977d]">
              Cada conta acessa apenas seus próprios bots e configurações.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function PlaceholderScreen() {
  return (
    <div className="animate-rise">
      <div className="mb-7"><h2 className="text-2xl font-black tracking-[-.04em]">Desempenho</h2><p className="mt-2 text-sm text-[#878391]">Acompanhe o crescimento e as conversas dos seus bots.</p></div>
      <div className="glass flex min-h-[420px] flex-col items-center justify-center rounded-3xl p-8 text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-[#7c5cff]/10 text-[#a994ff]"><Gauge size={28} /></div>
        <h3 className="mt-5 text-lg font-black">Relatórios avançados</h3>
        <p className="mt-2 max-w-md text-xs leading-6 text-[#777382]">Este módulo será alimentado pelas métricas reais dos canais e conversas.</p>
        <span className="mt-5 rounded-full border border-[#c8ff4d]/20 bg-[#c8ff4d]/[.06] px-3 py-1.5 text-[10px] font-extrabold text-[#d8ff80]">PRÓXIMA FASE</span>
      </div>
    </div>
  );
}

function MobileNav({ screen, setScreen }: { screen: Screen; setScreen: (screen: Screen) => void }) {
  return (
    <nav className="fixed inset-x-3 bottom-3 z-30 flex h-16 items-center justify-around rounded-2xl border border-white/[.1] bg-[#15131d]/95 px-2 shadow-2xl backdrop-blur-xl lg:hidden">
      {navItems.slice(0, 2).map((item) => {
        const Icon = item.icon;
        return <button key={item.id} onClick={() => setScreen(item.id)} className={`flex min-w-14 flex-col items-center gap-1 text-[9px] font-bold ${screen === item.id ? "text-[#c8ff4d]" : "text-[#777382]"}`}><Icon size={19} />{item.label.replace("Visão geral", "Início")}</button>;
      })}
      <button onClick={() => setScreen("create")} className="-mt-7 grid size-13 place-items-center rounded-2xl border-4 border-[#f8f7f4] bg-[#c8ff4d] text-black shadow-[0_8px_25px_rgba(26,115,232,.2)]"><Plus size={22} strokeWidth={3} /></button>
      {navItems.slice(2).map((item) => {
        const Icon = item.icon;
        return <button key={item.id} onClick={() => setScreen(item.id)} className={`flex min-w-14 flex-col items-center gap-1 text-[9px] font-bold ${screen === item.id ? "text-[#c8ff4d]" : "text-[#777382]"}`}><Icon size={19} />{item.id === "analytics" ? "Dados" : "Ajustes"}</button>;
      })}
    </nav>
  );
}

export function CriaBotApp() {
  const [hydrated, setHydrated] = useState(false);
  const [authMode, setAuthMode] = useState<AuthScreen>("login");
  const [user, setUser] = useState<AppUser | null>(null);
  const [bots, setBots] = useState<BotItem[]>([]);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [selectedBot, setSelectedBot] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [databaseReady, setDatabaseReady] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const ready = await checkDatabaseReady();
        setDatabaseReady(ready);
        if (!ready) {
          setHydrated(true);
          return;
        }
        const currentUser = await getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          const currentBots = await listBots(currentUser.id);
          setBots(currentBots);
          if (!currentBots.length) setScreen("create");
        }
      } catch {
        setNotice({
          type: "error",
          message: "Não foi possível carregar os dados da sua conta.",
        });
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const title = useMemo(() => {
    if (selectedBot) return "Gerenciar bot";
    return { dashboard: "Visão geral", bots: "Meus bots", create: "Criar novo bot", analytics: "Desempenho", settings: "Configurações" }[screen];
  }, [screen, selectedBot]);

  if (!hydrated) {
    return <div className="grid min-h-screen place-items-center"><div className="flex items-center gap-3 text-sm font-bold text-[#8f8b99]"><div className="size-5 animate-spin rounded-full border-2 border-white/10 border-t-[#c8ff4d]" /> Preparando seu painel...</div></div>;
  }
  if (!user) {
    return (
      <Auth
        mode={authMode}
        setMode={setAuthMode}
        databaseReady={databaseReady}
        onAuth={async (input) => {
          const authenticated =
            input.mode === "login"
              ? await signIn(input.email, input.password)
              : await signUp({
                  name: input.name,
                  email: input.email,
                  phone: input.phone,
                  password: input.password,
                });

          if (!authenticated) {
            return "Conta criada. Confirme o e-mail para entrar no painel.";
          }

          setUser(authenticated);
          const authenticatedBots = await listBots(authenticated.id);
          setBots(authenticatedBots);
          if (input.mode === "signup" || !authenticatedBots.length) {
            setScreen("create");
          }
          return null;
        }}
      />
    );
  }

  const selected = bots.find((bot) => bot.id === selectedBot);

  function showNotice(type: "success" | "error", message: string) {
    setNotice({ type, message });
    window.setTimeout(() => setNotice(null), 2600);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function toggleBot(id: string) {
    const original = bots.find((bot) => bot.id === id);
    if (!original) return;
    const updated: BotItem = {
      ...original,
      status: original.status === "active" ? "paused" : "active",
    };
    setBots((current) =>
      current.map((bot) => (bot.id === id ? updated : bot)),
    );

    try {
      await updateRemoteBot(updated);
    } catch {
      setBots((current) =>
        current.map((bot) => (bot.id === id ? original : bot)),
      );
      showNotice("error", "Não foi possível alterar o status do bot.");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function relinkLocalBot(id: string) {
    const original = bots.find((bot) => bot.id === id);
    if (!original) return;
    const botToRelink = original;

    const token = window.prompt(
      `Cole o token do BotFather para religar ${original.name} localmente:`,
    );
    if (!token?.trim()) return;

    try {
      const result = await registerLocalTelegramBot({
        botId: original.id,
        token: token.trim(),
      });
      const updated: BotItem = {
        ...botToRelink,
        status: "active",
        telegram: botToRelink.telegram
          ? {
              ...botToRelink.telegram,
              status: "connected",
              webhookRegistered: false,
              errorMessage:
                "Bot online em modo local. Ele responderá enquanto o npm run on estiver ligado.",
            }
          : botToRelink.telegram,
      };
      setBots((current) =>
        current.map((bot) => (bot.id === id ? updated : bot)),
      );
      showNotice("success", result.message ?? "Bot religado localmente.");
    } catch (caught) {
      showNotice(
        "error",
        caught instanceof Error
          ? caught.message
          : "Não foi possível religar o bot local.",
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function relinkLocalBotSmart(id: string) {
    const original = bots.find((bot) => bot.id === id);
    if (!original) return;
    const botToRelink = original;

    async function applyRelink(resultMessage?: string) {
      const updated: BotItem = {
        ...botToRelink,
        status: "active",
        telegram: botToRelink.telegram
          ? {
              ...botToRelink.telegram,
              status: "connected",
              webhookRegistered: false,
              errorMessage:
                "Bot online em modo local. Ele responderá enquanto o npm run on estiver ligado.",
            }
          : botToRelink.telegram,
      };
      setBots((current) =>
        current.map((bot) => (bot.id === id ? updated : bot)),
      );
      showNotice("success", resultMessage ?? "Bot ligado localmente.");
    }

    try {
      const result = await registerLocalTelegramBot({ botId: botToRelink.id });
      await applyRelink(result.message);
      return;
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Não foi possível ligar o bot local.";

      if (!message.toLowerCase().includes("token")) {
        showNotice("error", message);
        return;
      }
    }

    const token = window.prompt(
      `Cole o token do BotFather para ligar ${botToRelink.name} localmente:`,
    );
    if (!token?.trim()) return;

    try {
      const result = await registerLocalTelegramBot({
        botId: botToRelink.id,
        token: token.trim(),
      });
      await applyRelink(result.message);
    } catch (caught) {
      showNotice(
        "error",
        caught instanceof Error
          ? caught.message
          : "Não foi possível ligar o bot local.",
      );
    }
  }

  function updateBotInState(id: string, updater: (bot: BotItem) => BotItem) {
    setBots((current) =>
      current.map((bot) => (bot.id === id ? updater(bot) : bot)),
    );
  }

  function markBotRunning(id: string) {
    updateBotInState(id, (bot) => ({
      ...bot,
      status: "active",
      telegram: bot.telegram
        ? {
            ...bot.telegram,
            status: "connected",
            webhookRegistered: false,
            errorMessage:
              "Bot online em modo local. Ele responderá enquanto o npm run on estiver ligado.",
          }
        : bot.telegram,
    }));
  }

  function markBotStopped(id: string) {
    updateBotInState(id, (bot) => ({
      ...bot,
      status: "paused",
      telegram: bot.telegram
        ? {
            ...bot.telegram,
            status: "disabled",
            errorMessage: "Bot parado. Clique em iniciar para ligar novamente.",
          }
        : bot.telegram,
    }));
  }

  async function startLocalBot(id: string, action: "start" | "restart" = "start") {
    const bot = bots.find((item) => item.id === id);
    if (!bot) return;

    try {
      const result = await controlLocalTelegramBot({ botId: id, action });
      markBotRunning(id);
      showNotice(
        "success",
        result.message ??
          (action === "restart"
            ? "Bot reiniciado com sucesso."
            : "Bot iniciado com sucesso."),
      );
      return;
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Não foi possível ligar o bot local.";

      if (!message.toLowerCase().includes("token")) {
        showNotice("error", message);
        return;
      }
    }

    const token = window.prompt(
      `Cole o token do BotFather para ${
        action === "restart" ? "reiniciar" : "iniciar"
      } ${bot.name}:`,
    );
    if (!token?.trim()) return;

    try {
      const result = await registerLocalTelegramBot({
        botId: id,
        token: token.trim(),
      });
      markBotRunning(id);
      showNotice("success", result.message ?? "Bot iniciado com sucesso.");
    } catch (caught) {
      showNotice(
        "error",
        caught instanceof Error
          ? caught.message
          : "Não foi possível ligar o bot local.",
      );
    }
  }

  async function stopLocalBot(id: string) {
    try {
      const result = await controlLocalTelegramBot({ botId: id, action: "stop" });
      markBotStopped(id);
      showNotice("success", result.message ?? "Bot parado com sucesso.");
    } catch (caught) {
      showNotice(
        "error",
        caught instanceof Error
          ? caught.message
          : "Não foi possível parar o bot.",
      );
    }
  }

  async function deleteBot(id: string) {
    const bot = bots.find((item) => item.id === id);
    if (!bot) return;

    const confirmed = window.confirm(
      `Excluir o bot "${bot.name}"? Essa ação remove o bot do painel e não pode ser desfeita.`,
    );
    if (!confirmed) return;

    try {
      const result = await deleteRemoteBot(id);
      setBots((current) => current.filter((item) => item.id !== id));
      if (selectedBot === id) {
        setSelectedBot(null);
        setScreen("bots");
      }
      showNotice("success", result.message ?? "Bot excluído com sucesso.");
    } catch (caught) {
      showNotice(
        "error",
        caught instanceof Error
          ? caught.message
          : "Não foi possível excluir o bot.",
      );
    }
  }

  function navigate(next: Screen) {
    setSelectedBot(null);
    setScreen(next);
  }

  return (
    <div className="criabot-light noise min-h-screen">
      <Sidebar
        screen={screen}
        setScreen={navigate}
        user={user}
        botCount={bots.length}
        onLogout={() => {
          void signOut();
          setUser(null);
          setBots([]);
          setSelectedBot(null);
          setScreen("dashboard");
        }}
        mobileOpen={mobileOpen}
        closeMobile={() => setMobileOpen(false)}
      />
      <div className="min-h-screen lg:pl-[276px]">
        {screen !== "create" && (
          <Topbar title={title} onMenu={() => setMobileOpen(true)} />
        )}
        <main
          className={`mx-auto max-w-[1500px] px-4 pb-28 sm:px-7 lg:px-9 lg:pb-10 ${
            screen === "create" ? "pt-4 sm:pt-5" : "pt-5 sm:pt-7"
          }`}
        >
          {selected ? (
            <ManageBot
              bot={selected}
              onClose={() => { setSelectedBot(null); setScreen("bots"); }}
              onUpdate={(updated) => {
                setBots((current) =>
                  current.map((bot) => (bot.id === updated.id ? updated : bot)),
                );
                void updateRemoteBot(updated).catch(() =>
                  showNotice("error", "Não foi possível salvar as alterações."),
                );
              }}
            />
          ) : (
            <>
              {screen === "dashboard" && (
                <Dashboard
                  bots={bots}
                  setScreen={navigate}
                  onManage={setSelectedBot}
                  onStartLocal={(id) => void startLocalBot(id)}
                  onRestartLocal={(id) => void startLocalBot(id, "restart")}
                  onStopLocal={(id) => void stopLocalBot(id)}
                  onDelete={(id) => void deleteBot(id)}
                />
              )}
              {screen === "bots" && (
                <BotsScreen
                  bots={bots}
                  setScreen={navigate}
                  onManage={setSelectedBot}
                  onStartLocal={(id) => void startLocalBot(id)}
                  onRestartLocal={(id) => void startLocalBot(id, "restart")}
                  onStopLocal={(id) => void stopLocalBot(id)}
                  onDelete={(id) => void deleteBot(id)}
                />
              )}
              {screen === "create" && (
                <CreateTelegramBot
                  onCancel={() => navigate("bots")}
                  onCreate={async (input) => {
                      try {
                        const { bot: created, message } = await connectTelegramBot(input);
                        setBots((current) => [created, ...current]);
                        setSelectedBot(created.id);
                        setScreen("bots");
                        showNotice("success", message);
                      } catch (error) {
                        showNotice(
                          "error",
                          error instanceof Error
                            ? error.message
                            : "Não foi possível criar o bot.",
                        );
                        throw error;
                      }
                  }}
                />
              )}
              {screen === "analytics" && <PlaceholderScreen />}
              {screen === "settings" && (
                <SettingsScreen
                  user={user}
                  bots={bots}
                  onSaveProfile={async (name) => {
                    await updateProfile(user.id, name.trim());
                    setUser((current) =>
                      current ? { ...current, name: name.trim() } : current,
                    );
                    showNotice("success", "Perfil atualizado.");
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>
      {!selectedBot && <MobileNav screen={screen} setScreen={navigate} />}
      {notice && (
        <div
          className={`fixed bottom-24 right-4 z-[70] flex max-w-sm items-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold shadow-2xl lg:bottom-6 ${
            notice.type === "success"
              ? "border-[#c8ff4d]/20 bg-[#1a2110] text-[#d8ff80]"
              : "border-[#ff5c7a]/20 bg-[#241015] text-[#ff9cad]"
          }`}
        >
          {notice.type === "success" ? (
            <Check size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          {notice.message}
        </div>
      )}
    </div>
  );
}
