import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
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
    signup_disabled: "A criação de novas contas está desativada.",
    user_already_exists: "Já existe uma conta com este e-mail.",
    weak_password:
      "Essa senha é conhecida por ser fraca ou já apareceu em vazamentos. Crie uma senha nova e exclusiva.",
  };
  return (error.code && messages[error.code]) || error.message;
}

function validateNewPassword(password: string, confirmation: string) {
  if (password.length < 12) return "Use pelo menos 12 caracteres.";
  if (!/[a-z]/.test(password)) return "Inclua uma letra minúscula.";
  if (!/[A-Z]/.test(password)) return "Inclua uma letra maiúscula.";
  if (!/\d/.test(password)) return "Inclua um número.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Inclua um símbolo.";
  if (password !== confirmation) return "As senhas não coincidem.";
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
        void navigate({ to: "/dashboard" });
        return;
      }
      setHasAdmin(status.hasAdmin);
      setCreateAccount(!status.hasAdmin);
    });
  }, [navigate, statusFn]);

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
        await createFn({ data: { email, password } });
      } else {
        await loginFn({ data: { email, password } });
      }
      await navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(getAuthErrorMessage(error as Error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-7">
        <h1 className="font-display text-2xl font-semibold">PremiumStudio</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {createAccount
            ? "Crie a primeira conta administrativa."
            : "Entre no painel administrativo."}
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              minLength={createAccount ? 12 : 8}
              autoComplete={createAccount ? "new-password" : "current-password"}
              required
            />
            {createAccount ? (
              <p className="text-xs text-muted-foreground">
                Mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo. Não use uma
                senha reaproveitada.
              </p>
            ) : null}
          </div>
          {createAccount ? (
            <div className="space-y-2">
              <Label htmlFor="password_confirmation">Confirmar senha</Label>
              <Input
                id="password_confirmation"
                name="password_confirmation"
                type="password"
                minLength={12}
                autoComplete="new-password"
                required
              />
            </div>
          ) : null}
          <Button className="w-full" disabled={loading} type="submit">
            {loading ? "Aguarde..." : createAccount ? "Criar conta" : "Entrar"}
          </Button>
        </form>
        {hasAdmin === false ? (
          <Button
            className="mt-3 w-full"
            variant="ghost"
            onClick={() => setCreateAccount((value) => !value)}
          >
            {createAccount ? "Já tenho conta" : "Criar primeira conta"}
          </Button>
        ) : null}
      </Card>
    </main>
  );
}
