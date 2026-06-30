import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAdminAccount, getAuthStatus, loginAdminAccount } from "@/lib/api/auth.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: LoginPage });

type PasswordStrength = {
  label: "Fraca" | "Boa" | "Forte";
  helper: string;
  width: string;
  color: string;
};

function getAuthErrorMessage(error: { code?: string; message: string }) {
  const messages: Record<string, string> = {
    email_not_confirmed: "Confirme seu e-mail antes de entrar.",
    invalid_credentials: "E-mail ou senha incorretos.",
    over_email_send_rate_limit: "Muitos e-mails enviados. Aguarde alguns minutos.",
    signup_disabled: "A criacao de novas contas esta desativada.",
    user_already_exists: "Ja existe uma conta com este e-mail.",
    weak_password:
      "Essa senha e conhecida por ser fraca ou ja apareceu em vazamentos. Crie uma senha nova e exclusiva.",
  };
  return (error.code && messages[error.code]) || error.message;
}

function validateNewPassword(password: string, confirmation: string) {
  if (password.length < 12) return "Use pelo menos 12 caracteres.";
  if (!/[a-z]/.test(password)) return "Inclua uma letra minuscula.";
  if (!/[A-Z]/.test(password)) return "Inclua uma letra maiuscula.";
  if (!/\d/.test(password)) return "Inclua um numero.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Inclua um simbolo.";
  if (password !== confirmation) return "As senhas nao coincidem.";
  return null;
}

function getPasswordStrength(password: string): PasswordStrength | null {
  if (!password) return null;
  let score = 0;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) {
    return {
      label: "Fraca",
      helper: "Ainda falta seguranca.",
      width: "w-1/3",
      color: "bg-destructive",
    };
  }
  if (score <= 3) {
    return {
      label: "Boa",
      helper: "Quase perfeita.",
      width: "w-2/3",
      color: "bg-primary/70",
    };
  }
  return {
    label: "Forte",
    helper: "Boa para proteger seus bots.",
    width: "w-full",
    color: "bg-primary",
  };
}

function LoginPage() {
  const navigate = useNavigate();
  const statusFn = useServerFn(getAuthStatus);
  const loginFn = useServerFn(loginAdminAccount);
  const createFn = useServerFn(createAdminAccount);
  const [loading, setLoading] = useState(false);
  const [createAccount, setCreateAccount] = useState(false);
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordMismatch = Boolean(
    createAccount && passwordConfirmation && password !== passwordConfirmation,
  );

  useEffect(() => {
    void statusFn().then((status) => {
      if (status.authenticated) {
        void navigate({ to: "/painel" });
        return;
      }
      setHasAdmin(status.hasAdmin);
      setCreateAccount(!status.hasAdmin);
    });
  }, [navigate, statusFn]);

  function openLogin() {
    setCreateAccount(false);
    setAcceptedTerms(false);
    setPasswordConfirmation("");
  }

  function openSignup() {
    if (hasAdmin === null) return;
    setCreateAccount(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    if (createAccount) {
      const validationError = validateNewPassword(password, passwordConfirmation);
      if (validationError) {
        toast.error(validationError);
        return;
      }
      if (!acceptedTerms) {
        toast.error("Aceite os termos para criar sua conta.");
        return;
      }
    }
    setLoading(true);
    try {
      if (createAccount) {
        await createFn({
          data: {
            email,
            password,
          },
        });
      } else {
        await loginFn({ data: { email, password } });
      }
      await navigate({ to: "/painel" });
    } catch (error) {
      toast.error(getAuthErrorMessage(error as Error));
    } finally {
      setLoading(false);
    }
  }

  const accountModeText = createAccount
    ? hasAdmin
      ? "Crie sua conta para configurar seus proprios bots. Ela sera criada como creator."
      : "Cadastre a primeira conta dona da plataforma CriaBot."
    : "Entre para administrar seus bots, planos, pagamentos e automacoes.";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#f5f5f3_100%)] text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_25%_20%,rgba(37,99,235,.12),transparent_30rem)]" />
      <div className="pointer-events-none absolute bottom-[-12rem] left-[-12rem] h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-10rem] top-[20%] h-96 w-96 rounded-full bg-[#F1F0ED] blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between rounded-[1.75rem] border bg-background/90 px-4 py-3 shadow-sm backdrop-blur md:px-6">
          <BrandMark subtitle="Plataforma de bots para Telegram" />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              type="button"
              variant={!createAccount ? "default" : "ghost"}
              onClick={openLogin}
            >
              Login
            </Button>
            <Button
              size="sm"
              type="button"
              variant={createAccount ? "default" : "outline"}
              onClick={openSignup}
            >
              Cadastro
            </Button>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-9 py-8 lg:grid-cols-[1.04fr_0.96fr] lg:py-12">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-background/90 px-4 py-2 text-sm font-semibold text-primary shadow-sm backdrop-blur">
              <Sparkles className="h-4 w-4" />
              Crie bots para voce ou para seus clientes
            </div>

            <div className="max-w-3xl space-y-5">
              <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Sua plataforma para criar, vender e gerenciar bots.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Cada conta pode criar seus proprios bots com painel, token, banco, planos, mensagens
                e pagamentos separados. Voce continua com a conta admin para controlar a plataforma.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Bots independentes", "Cada bot com painel, token e banco separados."],
                ["Pronto para vender", "Planos, Pix, webhooks e entregas em um so lugar."],
                ["Feito para crescer", "Criadores entram, configuram e gerenciam seus bots."],
              ].map(([title, description]) => (
                <div
                  className="rounded-[1.6rem] border bg-card p-4 shadow-sm backdrop-blur"
                  key={title}
                >
                  <CheckCircle2 className="mb-3 h-5 w-5 text-primary" />
                  <h2 className="font-semibold text-foreground">{title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 rounded-[1.75rem] border bg-card p-4 shadow-sm backdrop-blur sm:grid-cols-3">
              {[
                ["Admin", "Sua conta antiga continua dona da plataforma."],
                ["Creator", "Novas contas criam apenas os proprios bots."],
                ["Seguro", "Tokens ficam no servidor, longe do navegador."],
              ].map(([title, description]) => (
                <div className="flex gap-3" key={title}>
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <div className="text-sm font-semibold">{title}</div>
                    <div className="text-xs leading-5 text-muted-foreground">{description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Card className="mx-auto w-full max-w-[460px] overflow-hidden border bg-card p-0 shadow-[0_24px_70px_rgba(17,17,17,0.08)] backdrop-blur">
            <div className="bg-primary p-6 text-primary-foreground">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold opacity-90">
                    {createAccount ? "Criar acesso" : "Acesso ao painel"}
                  </p>
                  <h2 className="mt-2 font-display text-3xl font-semibold">
                    {createAccount ? "Cadastrar conta" : "Entrar no CriaBot"}
                  </h2>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
                  {createAccount ? (
                    <Zap className="h-6 w-6" />
                  ) : (
                    <LockKeyhole className="h-6 w-6" />
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 opacity-95">{accountModeText}</p>
            </div>

            <div className="p-5 sm:p-6">
              <div className="grid grid-cols-2 rounded-2xl bg-muted p-1">
                <button
                  className={cn(
                    "rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                    !createAccount
                      ? "bg-background text-primary shadow-sm"
                      : "text-muted-foreground",
                  )}
                  type="button"
                  onClick={openLogin}
                >
                  Login
                </button>
                <button
                  className={cn(
                    "rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                    createAccount
                      ? "bg-background text-primary shadow-sm"
                      : "text-muted-foreground",
                  )}
                  type="button"
                  onClick={openSignup}
                >
                  Cadastro
                </button>
              </div>

              <form className="mt-6 space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-12 rounded-2xl bg-background pl-11"
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="voce@email.com"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <div className="relative">
                    <Input
                      className="h-12 rounded-2xl bg-background pr-11"
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      minLength={createAccount ? 12 : 8}
                      autoComplete={createAccount ? "new-password" : "current-password"}
                      placeholder="Digite sua senha"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                    <button
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-3 top-1/2 rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-primary"
                      onClick={() => setShowPassword((value) => !value)}
                      type="button"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {createAccount && passwordStrength ? (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Forca da senha</span>
                        <span className="font-semibold text-foreground">
                          {passwordStrength.label} - {passwordStrength.helper}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            passwordStrength.width,
                            passwordStrength.color,
                          )}
                        />
                      </div>
                    </div>
                  ) : createAccount ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use 12+ caracteres com maiuscula, minuscula, numero e simbolo.
                    </p>
                  ) : null}
                </div>

                {createAccount ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="password_confirmation">Confirmar senha</Label>
                      <div className="relative">
                        <Input
                          className={cn(
                            "h-12 rounded-2xl bg-background pr-11",
                            passwordMismatch ? "border-destructive" : "",
                          )}
                          id="password_confirmation"
                          name="password_confirmation"
                          type={showPasswordConfirmation ? "text" : "password"}
                          minLength={12}
                          autoComplete="new-password"
                          placeholder="Repita a senha"
                          value={passwordConfirmation}
                          onChange={(event) => setPasswordConfirmation(event.target.value)}
                          required
                        />
                        <button
                          aria-label={showPasswordConfirmation ? "Ocultar senha" : "Mostrar senha"}
                          className="absolute right-3 top-1/2 rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-primary"
                          onClick={() => setShowPasswordConfirmation((value) => !value)}
                          type="button"
                        >
                          {showPasswordConfirmation ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {passwordConfirmation ? (
                        <p
                          className={cn(
                            "text-xs font-medium",
                            passwordMismatch ? "text-destructive" : "text-primary",
                          )}
                        >
                          {passwordMismatch ? "As senhas nao coincidem." : "As senhas coincidem."}
                        </p>
                      ) : null}
                    </div>

                    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                      <input
                        checked={acceptedTerms}
                        className="mt-1 accent-primary"
                        onChange={(event) => setAcceptedTerms(event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        Li e aceito os{" "}
                        <a
                          className="font-semibold text-primary underline underline-offset-2"
                          href="/termos"
                          rel="noreferrer"
                          target="_blank"
                        >
                          termos de uso
                        </a>{" "}
                        do CriaBot.
                      </span>
                    </label>
                  </>
                ) : null}

                <Button
                  className="h-12 w-full rounded-2xl text-base"
                  disabled={loading || (createAccount && !acceptedTerms)}
                  type="submit"
                >
                  {loading ? "Aguarde..." : createAccount ? "Criar conta" : "Entrar"}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </form>

              <div className="mt-5 flex items-start gap-2 rounded-2xl border bg-accent/70 p-3 text-xs leading-5 text-accent-foreground">
                <Bot className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {createAccount
                    ? "Depois do cadastro, voce podera cadastrar seu bot pelo token do BotFather."
                    : "Use uma senha forte e nunca compartilhe tokens, chaves de pagamento ou acessos."}
                </p>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
