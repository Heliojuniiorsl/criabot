import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, CheckCircle2, LockKeyhole, Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAdminAccount, getAuthStatus, loginAdminAccount } from "@/lib/api/auth.functions";

export const Route = createFileRoute("/")({ component: LoginPage });

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

function LoginPage() {
  const navigate = useNavigate();
  const statusFn = useServerFn(getAuthStatus);
  const loginFn = useServerFn(loginAdminAccount);
  const createFn = useServerFn(createAdminAccount);
  const [loading, setLoading] = useState(false);
  const [createAccount, setCreateAccount] = useState(false);
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    void statusFn().then((status) => {
      if (status.authenticated) {
        void navigate({ to: "/bots" });
        return;
      }
      setHasAdmin(status.hasAdmin);
      setCreateAccount(!status.hasAdmin);
    });
  }, [navigate, statusFn]);

  function openLogin() {
    setCreateAccount(false);
  }

  function openSignup() {
    if (hasAdmin === null) return;
    setCreateAccount(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const passwordConfirmation = String(form.get("password_confirmation") ?? "");
    if (createAccount) {
      const validationError = validateNewPassword(password, passwordConfirmation);
      if (validationError) {
        toast.error(validationError);
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
      await navigate({ to: "/bots" });
    } catch (error) {
      toast.error(getAuthErrorMessage(error as Error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#e8f0fe,transparent_32rem),linear-gradient(135deg,#ffffff_0%,#f7f9fc_52%,#eef3fd_100%)] px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute right-[-12rem] top-[-12rem] h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10rem] left-[-10rem] h-80 w-80 rounded-full bg-chart-2/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-7xl flex-col">
        <header className="flex items-center justify-between rounded-full border bg-white/80 px-4 py-3 shadow-sm backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-lg font-semibold text-primary">CriaBot</div>
              <div className="hidden text-xs text-muted-foreground sm:block">
                Plataforma de bots para Telegram
              </div>
            </div>
          </div>
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

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.08fr_0.92fr] lg:py-14">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border bg-white/80 px-4 py-2 text-sm font-medium text-primary shadow-sm">
              <Sparkles className="h-4 w-4" />
              Painel unico para gerenciar seus bots
            </div>

            <div className="max-w-3xl space-y-5">
              <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Crie, controle e venda com bots no Telegram.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Configure planos, pagamentos Pix, mensagens automaticas, grupos, usuarios e entregas
                digitais em uma tela limpa, rapida e pronta para crescer.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Bots independentes", "Cada bot com painel, token e banco separados."],
                ["Pagamento integrado", "Pix Mercado Pago com webhooks e historico."],
                ["Automacao total", "Mensagens, grupos, acessos e midias no painel."],
              ].map(([title, description]) => (
                <div
                  className="rounded-3xl border bg-white/75 p-4 shadow-sm backdrop-blur"
                  key={title}
                >
                  <CheckCircle2 className="mb-3 h-5 w-5 text-primary" />
                  <h2 className="font-semibold">{title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </div>

          <Card className="mx-auto w-full max-w-md overflow-hidden border bg-white/90 p-0 shadow-xl backdrop-blur">
            <div className="border-b bg-gradient-to-br from-primary to-[#4f8df5] p-6 text-primary-foreground">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium opacity-90">
                    {createAccount ? "Primeira configuracao" : "Acesso administrativo"}
                  </p>
                  <h2 className="mt-2 font-display text-3xl font-semibold">
                    {createAccount ? "Criar conta" : "Entrar no painel"}
                  </h2>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
                  {createAccount ? (
                    <Zap className="h-6 w-6" />
                  ) : (
                    <LockKeyhole className="h-6 w-6" />
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 opacity-90">
                {createAccount
                  ? hasAdmin
                    ? "Crie sua conta para configurar seus proprios bots."
                    : "Cadastre a primeira conta dona do painel CriaBot."
                  : "Use seu e-mail e senha para administrar seus bots."}
              </p>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 rounded-2xl bg-muted p-1">
                <button
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    !createAccount ? "bg-white text-primary shadow-sm" : "text-muted-foreground"
                  }`}
                  type="button"
                  onClick={openLogin}
                >
                  Login
                </button>
                <button
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    createAccount ? "bg-white text-primary shadow-sm" : "text-muted-foreground"
                  }`}
                  type="button"
                  onClick={openSignup}
                >
                  Cadastro
                </button>
              </div>

              <form className="mt-6 space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    className="h-12 rounded-2xl bg-white"
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="voce@email.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    className="h-12 rounded-2xl bg-white"
                    id="password"
                    name="password"
                    type="password"
                    minLength={createAccount ? 12 : 8}
                    autoComplete={createAccount ? "new-password" : "current-password"}
                    placeholder="Digite sua senha"
                    required
                  />
                  {createAccount ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use 12+ caracteres com maiuscula, minuscula, numero e simbolo.
                    </p>
                  ) : null}
                </div>
                {createAccount ? (
                  <div className="space-y-2">
                    <Label htmlFor="password_confirmation">Confirmar senha</Label>
                    <Input
                      className="h-12 rounded-2xl bg-white"
                      id="password_confirmation"
                      name="password_confirmation"
                      type="password"
                      minLength={12}
                      autoComplete="new-password"
                      placeholder="Repita a senha"
                      required
                    />
                  </div>
                ) : null}
                <Button
                  className="h-12 w-full rounded-2xl text-base"
                  disabled={loading}
                  type="submit"
                >
                  {loading ? "Aguarde..." : createAccount ? "Criar conta" : "Entrar"}
                </Button>
              </form>

              <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
                Ambiente privado. Proteja seus tokens, chaves de pagamento e acessos de
                administrador.
              </p>
            </div>
          </Card>
        </section>
      </div>
    </main>
  );
}
