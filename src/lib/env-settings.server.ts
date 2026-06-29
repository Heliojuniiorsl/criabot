import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type EnvPanelBotKey = "sales" | "images";

type EnvGroup = "bots" | "urls" | "payments";

type EnvMeta = {
  label: string;
  description: string;
  group: EnvGroup;
  secret?: boolean;
  reconnectBots?: boolean;
};

export type EnvSettingForPanel = EnvMeta & {
  key: string;
  value: string;
  configured: boolean;
  known: boolean;
};

const envPath = resolve(process.cwd(), ".env");

const knownEnv: Record<string, EnvMeta> = {
  PUBLIC_BASE_URL: {
    label: "URL publica",
    description: "URL HTTPS usada nos webhooks do Telegram e Mercado Pago.",
    group: "urls",
    reconnectBots: true,
  },
  MERCADO_PAGO_ACCESS_TOKEN: {
    label: "Access token Mercado Pago",
    description: "Token usado para criar Pix real e consultar pagamentos.",
    group: "payments",
    secret: true,
  },
  MERCADO_PAGO_PUBLIC_KEY: {
    label: "Public key Mercado Pago",
    description: "Chave publica do Mercado Pago.",
    group: "payments",
  },
  MERCADO_PAGO_WEBHOOK_SECRET: {
    label: "Webhook secret Mercado Pago",
    description: "Segredo usado para validar as notificacoes recebidas do Mercado Pago.",
    group: "payments",
    secret: true,
  },
};

const sharedAllowedEnvKeys = [
  "PUBLIC_BASE_URL",
  "MERCADO_PAGO_ACCESS_TOKEN",
  "MERCADO_PAGO_PUBLIC_KEY",
  "MERCADO_PAGO_WEBHOOK_SECRET",
] as const;

const allowedEnvKeysByBot: Record<EnvPanelBotKey, readonly string[]> = {
  sales: [...sharedAllowedEnvKeys],
  images: [...sharedAllowedEnvKeys],
};

const webhookPathsByBot: Record<EnvPanelBotKey, string> = {
  sales: "/api/public/telegram/webhook",
  images: "/api/public/telegram/image-webhook",
};

function allowedEnvKeys(botKey: EnvPanelBotKey) {
  return new Set(allowedEnvKeysByBot[botKey]);
}

function parseEnv(content: string) {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    let value = trimmed.slice(index + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function readEnvValues() {
  if (!existsSync(envPath)) return new Map<string, string>();
  return parseEnv(readFileSync(envPath, "utf8"));
}

function quoteEnvValue(value: string) {
  if (!value) return "";
  if (/[\r\n]/.test(value)) throw new Error("Valores do .env nao podem ter quebra de linha");
  if (/^\s|\s$|[#"'`]/.test(value)) return JSON.stringify(value);
  return value;
}

export function getEnvSettingsForPanel(botKey: EnvPanelBotKey) {
  const current = readEnvValues();
  const allowed = allowedEnvKeys(botKey);
  const groupOrder: EnvGroup[] = ["bots", "urls", "payments"];
  const keys = Object.keys(knownEnv)
    .filter((key) => allowed.has(key))
    .sort((left, right) => {
      const leftGroup = groupOrder.indexOf(knownEnv[left].group);
      const rightGroup = groupOrder.indexOf(knownEnv[right].group);
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
      return left.localeCompare(right);
    });

  const publicBaseUrl = (
    current.get("PUBLIC_BASE_URL") ??
    process.env.PUBLIC_BASE_URL ??
    ""
  ).replace(/\/$/, "");

  return {
    env_path: envPath,
    webhook_urls: {
      telegram: publicBaseUrl ? `${publicBaseUrl}${webhookPathsByBot[botKey]}` : "",
      mercado_pago: publicBaseUrl ? `${publicBaseUrl}/api/public/payments/webhook` : "",
    },
    settings: keys.map((key): EnvSettingForPanel => {
      const value = current.get(key) ?? process.env[key] ?? "";
      return {
        key,
        ...knownEnv[key],
        value,
        configured: value.length > 0,
        known: true,
      };
    }),
  };
}

export function saveEnvSettingsFromPanel(botKey: EnvPanelBotKey, values: Record<string, string>) {
  const allowed = allowedEnvKeys(botKey);
  const keys = Object.keys(values);
  for (const key of keys) {
    if (!/^[A-Z0-9_]+$/.test(key)) throw new Error(`Variavel invalida: ${key}`);
    if (!allowed.has(key)) throw new Error(`Variavel nao permitida para este bot: ${key}`);
    if (values[key].length > 20_000) throw new Error(`Valor muito grande para ${key}`);
  }

  const original = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const seen = new Set<string>();
  const changedKeys: string[] = [];
  const lines = original.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*)$/);
    if (!match || !(match[2] in values)) return line;
    const key = match[2];
    seen.add(key);
    const nextValue = values[key] ?? "";
    if ((process.env[key] ?? "") !== nextValue) changedKeys.push(key);
    process.env[key] = nextValue;
    return `${match[1]}${key}${match[3]}${quoteEnvValue(nextValue)}`;
  });

  for (const key of keys) {
    if (seen.has(key)) continue;
    const nextValue = values[key] ?? "";
    if ((process.env[key] ?? "") !== nextValue) changedKeys.push(key);
    process.env[key] = nextValue;
    lines.push(`${key}=${quoteEnvValue(nextValue)}`);
  }

  writeFileSync(envPath, `${lines.join("\n").replace(/\n+$/g, "")}\n`);

  const reconnectBotKeys = changedKeys.filter((key) => knownEnv[key]?.reconnectBots);
  return {
    ok: true,
    changed_keys: [...new Set(changedKeys)],
    reconnect_bot_keys: [...new Set(reconnectBotKeys)],
  };
}
