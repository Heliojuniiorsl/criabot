import Database from "better-sqlite3";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

type Row = Record<string, any>;
type QueryResult = { data: any; error: { message: string; code?: string } | null; count?: number };

const databasePath = resolve(process.env.DATABASE_PATH ?? "data/botvendassl.sqlite");
export const mediaRoot = resolve(process.env.MEDIA_DIR ?? "data/media");

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(mediaRoot, { recursive: true });

export const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS admin_accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER NOT NULL UNIQUE,
    telegram_username TEXT,
    name TEXT,
    is_adult_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL DEFAULT 30,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'foto' CHECK (type IN ('foto', 'video', 'pacote')),
    price REAL NOT NULL DEFAULT 0,
    preview_url TEXT,
    file_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
    content_id TEXT REFERENCES contents(id) ON DELETE SET NULL,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled', 'expired')),
    fulfilled_at TEXT,
    delivery_claimed_at TEXT,
    delivery_sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'canceled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'manual',
    provider_payment_id TEXT UNIQUE,
    provider_preference_id TEXT,
    payment_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled', 'expired')),
    raw_status TEXT,
    amount REAL,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bot_settings (
    id TEXT PRIMARY KEY,
    welcome_message TEXT NOT NULL,
    welcome_image_url TEXT,
    terms_text TEXT NOT NULL,
    support_link TEXT,
    private_group_link TEXT,
    payment_info TEXT,
    menu_buttons TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    image_url TEXT,
    buttons TEXT NOT NULL DEFAULT '[]',
    interval_hours INTEGER NOT NULL DEFAULT 24,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT,
    locked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS telegram_updates (
    update_id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const defaultButtons = [
  { id: "plans", label: "Ver planos", enabled: true },
  { id: "contents", label: "Comprar conteúdo", enabled: true },
  { id: "myaccess", label: "Meus acessos", enabled: true },
  { id: "support", label: "Suporte", enabled: true },
  { id: "terms", label: "Termos e regras", enabled: true },
];

sqlite
  .prepare(
    `INSERT OR IGNORE INTO bot_settings
      (id, welcome_message, terms_text, menu_buttons)
     VALUES (?, ?, ?, ?)`,
  )
  .run(
    "00000000-0000-4000-8000-000000000001",
    "Bem-vindo(a)! Conteúdo exclusivo para maiores de 18 anos.",
    "Ao usar este serviço você confirma ter 18 anos ou mais e concorda com os termos.",
    JSON.stringify(defaultButtons),
  );

const booleanColumns: Record<string, Set<string>> = {
  users: new Set(["is_adult_confirmed"]),
  plans: new Set(["is_active"]),
  contents: new Set(["is_active"]),
  broadcasts: new Set(["is_active"]),
};
const jsonColumns: Record<string, Set<string>> = {
  bot_settings: new Set(["menu_buttons"]),
  broadcasts: new Set(["buttons"]),
};
const tablesWithId = new Set([
  "users",
  "plans",
  "contents",
  "orders",
  "subscriptions",
  "payments",
  "bot_settings",
  "broadcasts",
]);
const tablesWithUpdatedAt = new Set([
  "users",
  "plans",
  "contents",
  "orders",
  "subscriptions",
  "payments",
  "bot_settings",
  "broadcasts",
]);
const allowedTables = new Set([
  ...tablesWithId,
  "telegram_updates",
  "admin_accounts",
  "admin_sessions",
]);

function assertIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("Identificador de banco inválido");
  return `"${value}"`;
}

function serializeValue(table: string, column: string, value: any) {
  if (value === undefined) return null;
  if (booleanColumns[table]?.has(column)) return value ? 1 : 0;
  if (jsonColumns[table]?.has(column)) return JSON.stringify(value ?? []);
  return value;
}

function normalizeRow(table: string, row: Row | undefined): Row | null {
  if (!row) return null;
  const result = { ...row };
  for (const column of booleanColumns[table] ?? []) result[column] = Boolean(result[column]);
  for (const column of jsonColumns[table] ?? []) {
    try {
      result[column] =
        typeof result[column] === "string" ? JSON.parse(result[column]) : result[column];
    } catch {
      result[column] = [];
    }
  }
  return result;
}

function errorResult(error: unknown): QueryResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code?.startsWith("SQLITE_CONSTRAINT")
    ? "23505"
    : (error as { code?: string })?.code;
  return { data: null, error: { message, code } };
}

type Filter = { column: string; operator: "=" | ">" | ">=" | "<="; value: any };

class LocalQuery implements PromiseLike<QueryResult> {
  private operation: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: Row | Row[] | undefined;
  private filters: Filter[] = [];
  private orFilter: string | undefined;
  private orderBy: { column: string; ascending: boolean } | undefined;
  private rowLimit: number | undefined;
  private selection = "*";
  private countMode = false;
  private headMode = false;
  private singleMode: "single" | "maybe" | undefined;

  constructor(private readonly table: string) {
    if (!allowedTables.has(table)) throw new Error(`Tabela não permitida: ${table}`);
  }

  select(columns = "*", options?: { count?: string; head?: boolean }) {
    this.selection = columns;
    this.countMode = options?.count === "exact";
    this.headMode = Boolean(options?.head);
    return this;
  }

  insert(values: Row | Row[]) {
    this.operation = "insert";
    this.payload = values;
    return this;
  }

  upsert(values: Row | Row[], _options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.payload = values;
    return this;
  }

  update(values: Row) {
    this.operation = "update";
    this.payload = values;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, operator: "=", value });
    return this;
  }

  gt(column: string, value: any) {
    this.filters.push({ column, operator: ">", value });
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push({ column, operator: ">=", value });
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push({ column, operator: "<=", value });
    return this;
  }

  or(expression: string) {
    this.orFilter = expression;
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this.execute();
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this.execute();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private whereClause() {
    const clauses: string[] = [];
    const values: any[] = [];
    for (const filter of this.filters) {
      clauses.push(`${assertIdentifier(filter.column)} ${filter.operator} ?`);
      values.push(serializeValue(this.table, filter.column, filter.value));
    }
    if (this.orFilter) {
      const parts = this.orFilter.split(",").map((part) => {
        const match = part.match(/^([a-z_][a-z0-9_]*)\.(eq|lte|gte|gt)\.(.+)$/i);
        if (!match) throw new Error("Filtro OR inválido");
        const operators = { eq: "=", lte: "<=", gte: ">=", gt: ">" } as const;
        values.push(serializeValue(this.table, match[1], match[3]));
        return `${assertIdentifier(match[1])} ${operators[match[2] as keyof typeof operators]} ?`;
      });
      clauses.push(`(${parts.join(" OR ")})`);
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", values };
  }

  private enrich(rows: Row[]) {
    if (this.table === "subscriptions" && this.selection.includes("plans(")) {
      const plan = sqlite.prepare("SELECT name FROM plans WHERE id = ?");
      return rows.map((row) => ({
        ...row,
        plans: row.plan_id ? (plan.get(row.plan_id) ?? null) : null,
      }));
    }
    if (this.table === "orders" && this.selection.includes("users(")) {
      const user = sqlite.prepare(
        "SELECT name, telegram_username, telegram_id FROM users WHERE id = ?",
      );
      const plan = sqlite.prepare("SELECT name FROM plans WHERE id = ?");
      const content = sqlite.prepare("SELECT title, type, file_url FROM contents WHERE id = ?");
      return rows.map((row) => ({
        ...row,
        users: user.get(row.user_id) ?? null,
        plans: row.plan_id ? (plan.get(row.plan_id) ?? null) : null,
        contents: row.content_id ? (content.get(row.content_id) ?? null) : null,
      }));
    }
    return rows;
  }

  private writeRows(mode: "insert" | "upsert") {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    const written: Row[] = [];
    const transaction = sqlite.transaction(() => {
      for (const original of rows) {
        const row = { ...original };
        if (tablesWithId.has(this.table) && !row.id) row.id = randomUUID();
        if (tablesWithUpdatedAt.has(this.table)) {
          const now = new Date().toISOString();
          if (!row.created_at) row.created_at = now;
          if (!row.updated_at) row.updated_at = now;
        }
        const columns = Object.keys(row).filter((key) => row[key] !== undefined);
        const placeholders = columns.map(() => "?").join(", ");
        const userUpsert = mode === "upsert" && this.table === "users";
        const conflict = mode === "upsert" && !userUpsert ? " OR REPLACE" : "";
        const upsertClause = userUpsert
          ? ` ON CONFLICT (telegram_id) DO UPDATE SET ${columns
              .filter((column) => column !== "id" && column !== "telegram_id")
              .map((column) => `${assertIdentifier(column)} = excluded.${assertIdentifier(column)}`)
              .join(", ")}, updated_at = excluded.updated_at`
          : "";
        sqlite
          .prepare(
            `INSERT${conflict} INTO ${assertIdentifier(this.table)} (${columns
              .map(assertIdentifier)
              .join(", ")}) VALUES (${placeholders})${upsertClause}`,
          )
          .run(...columns.map((column) => serializeValue(this.table, column, row[column])));
        const keyColumn = userUpsert ? "telegram_id" : row.id ? "id" : "update_id";
        const saved = sqlite
          .prepare(
            `SELECT * FROM ${assertIdentifier(this.table)} WHERE ${assertIdentifier(keyColumn)} = ?`,
          )
          .get(row[keyColumn]) as Row;
        written.push(normalizeRow(this.table, saved) ?? row);
      }
    });
    transaction();
    return written;
  }

  private async execute(): Promise<QueryResult> {
    try {
      let rows: Row[] = [];
      const where = this.whereClause();

      if (this.operation === "insert" || this.operation === "upsert") {
        rows = this.writeRows(this.operation);
      } else if (this.operation === "update") {
        const values = { ...(this.payload as Row) };
        if (tablesWithUpdatedAt.has(this.table)) values.updated_at = new Date().toISOString();
        const columns = Object.keys(values).filter((key) => values[key] !== undefined);
        if (!columns.length) return { data: null, error: null };
        sqlite
          .prepare(
            `UPDATE ${assertIdentifier(this.table)} SET ${columns
              .map((column) => `${assertIdentifier(column)} = ?`)
              .join(", ")}${where.sql}`,
          )
          .run(
            ...columns.map((column) => serializeValue(this.table, column, values[column])),
            ...where.values,
          );
      } else if (this.operation === "delete") {
        sqlite
          .prepare(`DELETE FROM ${assertIdentifier(this.table)}${where.sql}`)
          .run(...where.values);
      }

      if (this.operation === "select") {
        const order = this.orderBy
          ? ` ORDER BY ${assertIdentifier(this.orderBy.column)} ${this.orderBy.ascending ? "ASC" : "DESC"}`
          : "";
        const limit = this.rowLimit ? ` LIMIT ${Math.max(1, Math.trunc(this.rowLimit))}` : "";
        rows = sqlite
          .prepare(`SELECT * FROM ${assertIdentifier(this.table)}${where.sql}${order}${limit}`)
          .all(...where.values)
          .map((row) => normalizeRow(this.table, row as Row) as Row);
      } else if (this.selection !== "*") {
        rows = rows.map((row) => normalizeRow(this.table, row) as Row);
      }

      rows = this.enrich(rows);
      const count = this.countMode ? rows.length : undefined;
      if (this.headMode) return { data: null, error: null, count };
      if (this.singleMode) {
        if (!rows.length && this.singleMode === "single") {
          return { data: null, error: { message: "Registro não encontrado" }, count };
        }
        return { data: rows[0] ?? null, error: null, count };
      }
      return { data: rows, error: null, count };
    } catch (error) {
      return errorResult(error);
    }
  }
}

function mediaSecret() {
  return process.env.MEDIA_SIGNING_SECRET ?? process.env.TELEGRAM_BOT_TOKEN ?? "local-development";
}

export function resolveMediaPath(path: string) {
  const filePath = resolve(mediaRoot, path);
  if (filePath !== mediaRoot && !filePath.startsWith(`${mediaRoot}${sep}`)) {
    throw new Error("Caminho de mídia inválido");
  }
  return filePath;
}

export function signPrivateMedia(path: string, expires: number) {
  return createHmac("sha256", mediaSecret()).update(`${path}:${expires}`).digest("hex");
}

export function verifyPrivateMedia(path: string, expires: number, signature: string) {
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signPrivateMedia(path, expires));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function createStorageBucket() {
  return {
    async upload(
      path: string,
      bytes: Buffer,
      _options?: { contentType?: string; upsert?: boolean },
    ) {
      try {
        const filePath = resolveMediaPath(path);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, bytes, { flag: "wx" });
        return { data: { path }, error: null };
      } catch (error) {
        return errorResult(error);
      }
    },
    async download(path: string) {
      try {
        const bytes = readFileSync(resolveMediaPath(path));
        return { data: new Blob([bytes]), error: null };
      } catch (error) {
        return errorResult(error);
      }
    },
    async createSignedUrl(path: string, expiresIn: number) {
      const expires = Math.floor(Date.now() / 1000) + expiresIn;
      const signature = signPrivateMedia(path, expires);
      const baseUrl = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
      return {
        data: {
          signedUrl: `${baseUrl}/api/public/media/${path}?expires=${expires}&signature=${signature}`,
        },
        error: null,
      };
    },
  };
}

function confirmPayment(args: Row) {
  const transaction = sqlite.transaction(() => {
    const order = sqlite.prepare("SELECT * FROM orders WHERE id = ?").get(args.p_order_id) as Row;
    if (!order) throw new Error("order_not_found");
    if (Math.round(Number(order.amount) * 100) !== Math.round(Number(args.p_amount) * 100)) {
      throw new Error("payment_amount_mismatch");
    }

    const now = new Date().toISOString();
    const payment = sqlite
      .prepare("SELECT id FROM payments WHERE order_id = ?")
      .get(order.id) as Row;
    if (payment) {
      sqlite
        .prepare(
          `UPDATE payments SET provider = 'mercado_pago', provider_payment_id = ?, status = 'paid',
           raw_status = ?, paid_at = ?, amount = ?, updated_at = ? WHERE order_id = ?`,
        )
        .run(
          args.p_provider_payment_id,
          args.p_provider_status,
          args.p_paid_at ?? now,
          args.p_amount,
          now,
          order.id,
        );
    } else {
      sqlite
        .prepare(
          `INSERT INTO payments
           (id, order_id, provider, provider_payment_id, status, raw_status, paid_at, amount)
           VALUES (?, ?, 'mercado_pago', ?, 'paid', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          order.id,
          args.p_provider_payment_id,
          args.p_provider_status,
          args.p_paid_at ?? now,
          args.p_amount,
        );
    }

    if (order.status === "paid") return false;
    sqlite
      .prepare("UPDATE orders SET status = 'paid', fulfilled_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, order.id);

    if (order.plan_id) {
      const plan = sqlite
        .prepare("SELECT duration_days FROM plans WHERE id = ?")
        .get(order.plan_id) as Row;
      if (!plan) throw new Error("plan_not_found");
      const latest = sqlite
        .prepare(
          "SELECT MAX(end_date) AS end_date FROM subscriptions WHERE user_id = ? AND status = 'active'",
        )
        .get(order.user_id) as Row;
      const startMs = Math.max(Date.now(), latest?.end_date ? Date.parse(latest.end_date) : 0);
      const start = new Date(startMs);
      const end = new Date(startMs + Number(plan.duration_days) * 86_400_000);
      sqlite
        .prepare(
          `INSERT INTO subscriptions
           (id, user_id, plan_id, start_date, end_date, status)
           VALUES (?, ?, ?, ?, ?, 'active')`,
        )
        .run(randomUUID(), order.user_id, order.plan_id, start.toISOString(), end.toISOString());
    }
    return true;
  });
  return transaction();
}

function claimOrderDelivery(orderId: string) {
  const threshold = new Date(Date.now() - 15 * 60_000).toISOString();
  const result = sqlite
    .prepare(
      `UPDATE orders SET delivery_claimed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'paid' AND delivery_sent_at IS NULL
       AND (delivery_claimed_at IS NULL OR delivery_claimed_at < ?)`,
    )
    .run(new Date().toISOString(), new Date().toISOString(), orderId, threshold);
  return result.changes > 0;
}

function claimDueBroadcasts() {
  const now = new Date();
  const threshold = new Date(now.getTime() - 15 * 60_000).toISOString();
  const candidates = sqlite
    .prepare(
      `SELECT * FROM broadcasts WHERE is_active = 1
       AND (locked_at IS NULL OR locked_at < ?)`,
    )
    .all(threshold)
    .map((row) => normalizeRow("broadcasts", row as Row) as Row)
    .filter((row) => {
      if (!row.last_sent_at) return true;
      return Date.parse(row.last_sent_at) <= now.getTime() - Number(row.interval_hours) * 3_600_000;
    });
  const lock = sqlite.prepare("UPDATE broadcasts SET locked_at = ?, updated_at = ? WHERE id = ?");
  const lockAll = sqlite.transaction(() => {
    for (const row of candidates) lock.run(now.toISOString(), now.toISOString(), row.id);
  });
  lockAll();
  return candidates.map((row) => ({ ...row, locked_at: now.toISOString() }));
}

export const localDb = {
  from(table: string) {
    return new LocalQuery(table);
  },
  async rpc(name: string, args: Row = {}) {
    try {
      if (name === "confirm_mercado_pago_payment") {
        return { data: confirmPayment(args), error: null };
      }
      if (name === "claim_order_delivery") {
        return { data: claimOrderDelivery(args.p_order_id), error: null };
      }
      if (name === "claim_due_broadcasts") {
        return { data: claimDueBroadcasts(), error: null };
      }
      throw new Error(`Função de banco desconhecida: ${name}`);
    } catch (error) {
      return errorResult(error);
    }
  },
  storage: {
    from(_bucket: string) {
      return createStorageBucket();
    },
  },
};
