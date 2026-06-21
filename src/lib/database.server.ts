import Database from "better-sqlite3";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import { getSalesBotRuntime } from "@/lib/sales-bot-runtime.server";

type Row = Record<string, any>;
type QueryResult = { data: any; error: { message: string; code?: string } | null; count?: number };

const databasePath = resolve(process.env.DATABASE_PATH ?? "data/botvendassl.sqlite");
export const mediaRoot = resolve(process.env.MEDIA_DIR ?? "data/media");

mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(mediaRoot, { recursive: true });

function configureDatabase(database: Database.Database) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("synchronous = NORMAL");
  database.pragma("temp_store = MEMORY");
  database.pragma("wal_autocheckpoint = 1000");
  database.pragma("busy_timeout = 15000");
  return database;
}

const primarySqlite = configureDatabase(new Database(databasePath));
const cloneDatabases = new Map<string, Database.Database>();

function activeSqlite() {
  const clonePath = getSalesBotRuntime()?.databasePath;
  if (!clonePath || clonePath === databasePath) return primarySqlite;
  const existing = cloneDatabases.get(clonePath);
  if (existing) return existing;
  mkdirSync(dirname(clonePath), { recursive: true });
  const database = configureDatabase(new Database(clonePath));
  ensureTelegramGroupsSupportsChannels(database);
  cloneDatabases.set(clonePath, database);
  return database;
}

export const sqlite = new Proxy(primarySqlite, {
  get(_target, property) {
    const database = activeSqlite();
    const value = Reflect.get(database, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
}) as Database.Database;

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("temp_store = MEMORY");
sqlite.pragma("wal_autocheckpoint = 1000");
sqlite.pragma("busy_timeout = 15000");

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
    description_mode TEXT NOT NULL DEFAULT 'custom'
      CHECK (description_mode IN ('custom', 'telegram_message')),
    description_source_chat_id INTEGER,
    description_source_message_id INTEGER,
    access_chat_id INTEGER,
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
    category TEXT NOT NULL DEFAULT 'Geral',
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
    welcome_mode TEXT NOT NULL DEFAULT 'custom'
      CHECK (welcome_mode IN ('custom', 'telegram_message')),
    welcome_source_chat_id INTEGER,
    welcome_source_message_id INTEGER,
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
    content_kind TEXT NOT NULL DEFAULT 'custom' CHECK (content_kind IN ('custom', 'telegram_message')),
    source_chat_id INTEGER,
    source_message_id INTEGER,
    buttons TEXT NOT NULL DEFAULT '[]',
    interval_hours INTEGER NOT NULL DEFAULT 24,
    interval_minutes INTEGER NOT NULL DEFAULT 60,
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

  CREATE TABLE IF NOT EXISTS telegram_groups (
    id TEXT PRIMARY KEY,
    telegram_chat_id INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    username TEXT,
    type TEXT NOT NULL CHECK (type IN ('group', 'supergroup', 'channel')),
    bot_status TEXT NOT NULL DEFAULT 'member',
    is_active INTEGER NOT NULL DEFAULT 1,
    member_count INTEGER,
    joined_at TEXT,
    left_at TEXT,
    last_activity_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS telegram_groups_active_idx
    ON telegram_groups(is_active, updated_at DESC);

  CREATE TABLE IF NOT EXISTS group_broadcasts (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES telegram_groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    image_url TEXT,
    buttons TEXT NOT NULL DEFAULT '[]',
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT,
    locked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS group_broadcasts_due_idx
    ON group_broadcasts(is_active, group_id, last_sent_at);

  CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    starts_at TEXT,
    ends_at TEXT,
    plan_ids TEXT NOT NULL DEFAULT '[]',
    content_ids TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS customer_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS customer_events_user_idx
    ON customer_events(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS bot_sessions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bot_rate_limits (
    telegram_id INTEGER NOT NULL,
    scope TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    window_start TEXT NOT NULL,
    blocked_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (telegram_id, scope)
  );
  CREATE INDEX IF NOT EXISTS bot_rate_limits_blocked_idx
    ON bot_rate_limits(blocked_until);

  CREATE TABLE IF NOT EXISTS telegram_access_grants (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    invite_link TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'expired', 'revoked')),
    expires_at TEXT NOT NULL,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, chat_id)
  );
  CREATE INDEX IF NOT EXISTS telegram_access_grants_lookup_idx
    ON telegram_access_grants(chat_id, telegram_user_id, invite_link, status);

`);

function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${assertIdentifier(table)})`).all() as Row[];
  if (!columns.some((item) => item.name === column)) {
    sqlite.exec(
      `ALTER TABLE ${assertIdentifier(table)} ADD COLUMN ${assertIdentifier(column)} ${definition}`,
    );
  }
}

function ensureTelegramGroupsSupportsChannels(database: Database.Database = sqlite) {
  const table = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'telegram_groups'")
    .get() as { sql: string } | undefined;
  if (!table?.sql || table.sql.includes("'channel'")) return;

  database.pragma("foreign_keys = OFF");
  try {
    database.exec(`
      DROP TABLE IF EXISTS telegram_groups_next;
      CREATE TABLE telegram_groups_next (
        id TEXT PRIMARY KEY,
        telegram_chat_id INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        username TEXT,
        type TEXT NOT NULL CHECK (type IN ('group', 'supergroup', 'channel')),
        bot_status TEXT NOT NULL DEFAULT 'member',
        is_active INTEGER NOT NULL DEFAULT 1,
        member_count INTEGER,
        joined_at TEXT,
        left_at TEXT,
        last_activity_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO telegram_groups_next
        (id, telegram_chat_id, title, username, type, bot_status, is_active, member_count,
         joined_at, left_at, last_activity_at, created_at, updated_at)
      SELECT id, telegram_chat_id, title, username, type, bot_status, is_active, member_count,
             joined_at, left_at, last_activity_at, created_at, updated_at
      FROM telegram_groups;
      DROP TABLE telegram_groups;
      ALTER TABLE telegram_groups_next RENAME TO telegram_groups;
      CREATE INDEX IF NOT EXISTS telegram_groups_active_idx
        ON telegram_groups(is_active, updated_at DESC);
    `);
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

ensureTelegramGroupsSupportsChannels();

addColumnIfMissing("users", "email", "TEXT");
addColumnIfMissing("users", "is_blocked", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "notes", "TEXT");
addColumnIfMissing("users", "tags", "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("users", "last_interaction_at", "TEXT");
addColumnIfMissing("plans", "promo_price", "REAL");
addColumnIfMissing("plans", "promo_starts_at", "TEXT");
addColumnIfMissing("plans", "promo_ends_at", "TEXT");
addColumnIfMissing("plans", "renewal_enabled", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("plans", "description_mode", "TEXT NOT NULL DEFAULT 'custom'");
addColumnIfMissing("plans", "description_source_chat_id", "INTEGER");
addColumnIfMissing("plans", "description_source_message_id", "INTEGER");
addColumnIfMissing("plans", "access_chat_id", "INTEGER");
addColumnIfMissing("contents", "category", "TEXT NOT NULL DEFAULT 'Geral'");
addColumnIfMissing("contents", "access_chat_id", "INTEGER");
addColumnIfMissing("orders", "offer_id", "TEXT");
addColumnIfMissing("orders", "auto_renew", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("orders", "pix_reminder_sent_at", "TEXT");
addColumnIfMissing("subscriptions", "auto_renew", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("subscriptions", "renewal_notice_sent_at", "TEXT");
addColumnIfMissing("subscriptions", "expiration_notice_sent_at", "TEXT");
addColumnIfMissing("payments", "pix_qr_code", "TEXT");
addColumnIfMissing("payments", "pix_qr_code_base64", "TEXT");
addColumnIfMissing("payments", "pix_ticket_url", "TEXT");
addColumnIfMissing("payments", "telegram_chat_id", "INTEGER");
addColumnIfMissing("payments", "telegram_message_id", "INTEGER");
addColumnIfMissing("payments", "telegram_message_type", "TEXT");
addColumnIfMissing("broadcasts", "audience_type", "TEXT NOT NULL DEFAULT 'all'");
addColumnIfMissing("broadcasts", "audience_value", "TEXT");
addColumnIfMissing("broadcasts", "activity_days", "INTEGER NOT NULL DEFAULT 30");
addColumnIfMissing("broadcasts", "content_kind", "TEXT NOT NULL DEFAULT 'custom'");
addColumnIfMissing("broadcasts", "source_chat_id", "INTEGER");
addColumnIfMissing("broadcasts", "source_message_id", "INTEGER");
const broadcastColumns = sqlite.prepare('PRAGMA table_info("broadcasts")').all() as Row[];
if (!broadcastColumns.some((column) => column.name === "interval_minutes")) {
  sqlite.exec('ALTER TABLE "broadcasts" ADD COLUMN "interval_minutes" INTEGER');
  sqlite.exec(
    'UPDATE "broadcasts" SET "interval_minutes" = MAX(1, "interval_hours" * 60) WHERE "interval_minutes" IS NULL',
  );
}
addColumnIfMissing("bot_settings", "renewal_notice_days", "INTEGER NOT NULL DEFAULT 3");
addColumnIfMissing("bot_settings", "expiration_message", "TEXT");
addColumnIfMissing("bot_settings", "welcome_mode", "TEXT NOT NULL DEFAULT 'custom'");
addColumnIfMissing("bot_settings", "welcome_source_chat_id", "INTEGER");
addColumnIfMissing("bot_settings", "welcome_source_message_id", "INTEGER");
addColumnIfMissing("bot_sessions", "created_at", "TEXT");
addColumnIfMissing("group_broadcasts", "buttons", "TEXT NOT NULL DEFAULT '[]'");

sqlite.exec(`
  CREATE INDEX IF NOT EXISTS orders_pending_product_idx
    ON orders(user_id, status, plan_id, content_id, offer_id, auto_renew, amount, created_at DESC);
  CREATE INDEX IF NOT EXISTS payments_order_status_idx
    ON payments(order_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS subscriptions_user_status_end_idx
    ON subscriptions(user_id, status, end_date DESC);
  CREATE INDEX IF NOT EXISTS contents_active_category_price_idx
    ON contents(is_active, category COLLATE NOCASE, price ASC, title COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS offers_active_price_idx
    ON offers(is_active, price ASC);
`);

const defaultButtons = [
  { id: "plans", label: "Ver planos", action: "plans", value: "", enabled: true },
  { id: "offers", label: "Ofertas e combos", action: "offers", value: "", enabled: true },
  { id: "terms", label: "Termos e regras", action: "terms", value: "", enabled: true },
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
  users: new Set(["is_adult_confirmed", "is_blocked"]),
  plans: new Set(["is_active", "renewal_enabled"]),
  contents: new Set(["is_active"]),
  offers: new Set(["is_active"]),
  orders: new Set(["auto_renew"]),
  subscriptions: new Set(["auto_renew"]),
  broadcasts: new Set(["is_active"]),
  group_broadcasts: new Set(["is_active"]),
};
const jsonColumns: Record<string, Set<string>> = {
  users: new Set(["tags"]),
  offers: new Set(["plan_ids", "content_ids"]),
  customer_events: new Set(["metadata"]),
  bot_sessions: new Set(["payload"]),
  bot_settings: new Set(["menu_buttons"]),
  broadcasts: new Set(["buttons"]),
  group_broadcasts: new Set(["buttons"]),
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
  "offers",
  "customer_events",
  "group_broadcasts",
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
  "offers",
  "bot_sessions",
  "group_broadcasts",
]);
const allowedTables = new Set([
  ...tablesWithId,
  "telegram_updates",
  "bot_sessions",
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
      const plan = sqlite.prepare("SELECT name, access_chat_id FROM plans WHERE id = ?");
      return rows.map((row) => ({
        ...row,
        plans: row.plan_id ? (plan.get(row.plan_id) ?? null) : null,
      }));
    }
    if (this.table === "orders" && this.selection.includes("users(")) {
      const user = sqlite.prepare(
        "SELECT name, telegram_username, telegram_id, email FROM users WHERE id = ?",
      );
      const plan = sqlite.prepare("SELECT name, access_chat_id FROM plans WHERE id = ?");
      const content = sqlite.prepare(
        "SELECT title, type, file_url, access_chat_id FROM contents WHERE id = ?",
      );
      const offer = sqlite.prepare(
        "SELECT name, description, plan_ids, content_ids FROM offers WHERE id = ?",
      );
      return rows.map((row) => ({
        ...row,
        users: user.get(row.user_id) ?? null,
        plans: row.plan_id ? (plan.get(row.plan_id) ?? null) : null,
        contents: row.content_id ? (content.get(row.content_id) ?? null) : null,
        offers: row.offer_id
          ? normalizeRow("offers", offer.get(row.offer_id) as Row | undefined)
          : null,
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
              .filter(
                (column) => column !== "id" && column !== "telegram_id" && column !== "created_at",
              )
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
        const keyColumn = userUpsert
          ? "telegram_id"
          : this.table === "bot_sessions"
            ? "user_id"
            : row.id
              ? "id"
              : "update_id";
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

function activatePlanSubscription(userId: string, planId: string, now: string, autoRenew = false) {
  const plan = sqlite.prepare("SELECT duration_days FROM plans WHERE id = ?").get(planId) as Row;
  if (!plan) throw new Error("plan_not_found");
  const latest = sqlite
    .prepare(
      `SELECT MAX(end_date) AS end_date FROM subscriptions
       WHERE user_id = ? AND plan_id = ? AND status = 'active'`,
    )
    .get(userId, planId) as Row;
  const startMs = Math.max(Date.now(), latest?.end_date ? Date.parse(latest.end_date) : 0);
  const end = new Date(startMs + Number(plan.duration_days) * 86_400_000);
  sqlite
    .prepare(
      `INSERT INTO subscriptions
       (id, user_id, plan_id, start_date, end_date, status, auto_renew)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    )
    .run(
      randomUUID(),
      userId,
      planId,
      new Date(startMs).toISOString(),
      end.toISOString(),
      autoRenew ? 1 : 0,
    );
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
      activatePlanSubscription(order.user_id, order.plan_id, now, Boolean(order.auto_renew));
    }
    if (order.offer_id) {
      const offer = sqlite
        .prepare("SELECT plan_ids FROM offers WHERE id = ?")
        .get(order.offer_id) as Row | undefined;
      const planIds = offer ? (normalizeRow("offers", offer)?.plan_ids ?? []) : [];
      for (const planId of planIds) activatePlanSubscription(order.user_id, planId, now);
    }

    sqlite
      .prepare(
        `INSERT INTO customer_events (id, user_id, type, description, metadata, created_at)
         VALUES (?, ?, 'payment_approved', 'Pagamento aprovado', ?, ?)`,
      )
      .run(randomUUID(), order.user_id, JSON.stringify({ order_id: order.id }), now);
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
      return (
        Date.parse(row.last_sent_at) <=
        now.getTime() - Math.max(1, Number(row.interval_minutes ?? 60)) * 60_000
      );
    });
  const lock = sqlite.prepare("UPDATE broadcasts SET locked_at = ?, updated_at = ? WHERE id = ?");
  const lockAll = sqlite.transaction(() => {
    for (const row of candidates) lock.run(now.toISOString(), now.toISOString(), row.id);
  });
  lockAll();
  return candidates.map((row) => ({ ...row, locked_at: now.toISOString() }));
}

function claimDueGroupBroadcasts() {
  const now = new Date();
  const threshold = new Date(now.getTime() - 15 * 60_000).toISOString();
  const candidates = sqlite
    .prepare(
      `SELECT gb.* FROM group_broadcasts gb
       JOIN telegram_groups tg ON tg.id = gb.group_id
       WHERE gb.is_active = 1 AND tg.is_active = 1
       AND (gb.locked_at IS NULL OR gb.locked_at < ?)`,
    )
    .all(threshold)
    .map((row) => normalizeRow("group_broadcasts", row as Row) as Row)
    .filter((row) => {
      if (!row.last_sent_at) return true;
      return (
        Date.parse(row.last_sent_at) <=
        now.getTime() - Math.max(1, Number(row.interval_minutes ?? 60)) * 60_000
      );
    });
  const lock = sqlite.prepare(
    "UPDATE group_broadcasts SET locked_at = ?, updated_at = ? WHERE id = ?",
  );
  const lockAll = sqlite.transaction(() => {
    for (const row of candidates) lock.run(now.toISOString(), now.toISOString(), row.id);
  });
  lockAll();
  return candidates.map((row) => ({ ...row, locked_at: now.toISOString() }));
}

export async function clonePrimarySalesDatabase(destinationPath: string) {
  const resolvedDestination = resolve(destinationPath);
  if (resolvedDestination === databasePath) {
    throw new Error("O banco do clone precisa ser diferente do banco principal");
  }

  mkdirSync(dirname(resolvedDestination), { recursive: true });
  primarySqlite.pragma("wal_checkpoint(PASSIVE)");
  await primarySqlite.backup(resolvedDestination);

  const clone = configureDatabase(new Database(resolvedDestination));
  const operationalTables = [
    "telegram_access_grants",
    "customer_events",
    "bot_sessions",
    "bot_rate_limits",
    "payments",
    "subscriptions",
    "orders",
    "users",
    "group_broadcasts",
    "telegram_groups",
    "telegram_updates",
    "admin_sessions",
  ];
  const existingTables = new Set(
    (
      clone.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );

  clone.pragma("foreign_keys = OFF");
  const clearOperationalData = clone.transaction(() => {
    for (const table of operationalTables) {
      if (existingTables.has(table)) clone.exec(`DELETE FROM ${table}`);
    }
    if (existingTables.has("broadcasts")) {
      clone.exec("UPDATE broadcasts SET last_sent_at = NULL, locked_at = NULL");
    }
  });
  clearOperationalData();
  clone.pragma("foreign_keys = ON");
  clone.close();
}

export function closeSalesBotCloneDatabases() {
  for (const database of cloneDatabases.values()) {
    if (database.open) database.close();
  }
  cloneDatabases.clear();
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
      if (name === "claim_due_group_broadcasts") {
        return { data: claimDueGroupBroadcasts(), error: null };
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

export type TelegramGroupInput = {
  telegramChatId: number;
  title: string;
  username?: string | null;
  type: "group" | "supergroup" | "channel";
  botStatus?: string;
  isActive?: boolean;
  memberCount?: number | null;
  activityAt?: string;
};

export type TelegramGroupRow = {
  id: string;
  telegram_chat_id: number;
  title: string;
  username: string | null;
  type: "group" | "supergroup" | "channel";
  bot_status: string;
  is_active: boolean;
  member_count: number | null;
  joined_at: string | null;
  left_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
};

export function upsertTelegramGroup(input: TelegramGroupInput) {
  const now = input.activityAt ?? new Date().toISOString();
  const existing = sqlite
    .prepare("SELECT * FROM telegram_groups WHERE telegram_chat_id = ?")
    .get(input.telegramChatId) as Row | undefined;
  const isActive = input.isActive ?? (existing ? Boolean(existing.is_active) : true);
  const botStatus = input.botStatus ?? (existing?.is_active ? existing.bot_status : "member");
  const joinedAt =
    isActive && (!existing || !existing.is_active) ? now : (existing?.joined_at ?? now);
  const leftAt = isActive ? null : now;
  const memberCount = input.memberCount ?? existing?.member_count ?? null;

  sqlite
    .prepare(
      `INSERT INTO telegram_groups
       (id, telegram_chat_id, title, username, type, bot_status, is_active, member_count,
        joined_at, left_at, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_chat_id) DO UPDATE SET
         title = excluded.title,
         username = excluded.username,
         type = excluded.type,
         bot_status = excluded.bot_status,
         is_active = excluded.is_active,
         member_count = excluded.member_count,
         joined_at = excluded.joined_at,
         left_at = excluded.left_at,
         last_activity_at = excluded.last_activity_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      existing?.id ?? randomUUID(),
      input.telegramChatId,
      input.title || "Grupo sem título",
      input.username ?? existing?.username ?? null,
      input.type,
      botStatus,
      isActive ? 1 : 0,
      memberCount,
      joinedAt,
      leftAt,
      now,
      existing?.created_at ?? now,
      now,
    );

  return getTelegramGroups().find((group) => group.telegram_chat_id === input.telegramChatId);
}

export function getTelegramGroups(): TelegramGroupRow[] {
  return (
    sqlite
      .prepare(
        `SELECT * FROM telegram_groups
       ORDER BY is_active DESC, COALESCE(last_activity_at, updated_at) DESC`,
      )
      .all() as Row[]
  ).map((row) => ({ ...row, is_active: Boolean(row.is_active) }) as TelegramGroupRow);
}

const schedulerGlobal = globalThis as typeof globalThis & {
  __botVendasSubscriptionScheduler?: ReturnType<typeof setInterval>;
};

if (
  process.env.NODE_ENV !== "test" &&
  (process.env.TELEGRAM_BOT_TOKEN || process.env.IMAGE_BOT_TOKEN) &&
  !schedulerGlobal.__botVendasSubscriptionScheduler
) {
  const intervalMinutes = Math.max(1, Number(process.env.AUTOMATION_INTERVAL_MINUTES ?? 1));
  const run = () => {
    void Promise.all([
      import("./sales.server"),
      import("./broadcast.server"),
      import("./image-bot-broadcast.server"),
      import("./image-bot-premium-reminders.server"),
      import("./sales-bot-registry.server"),
      import("./sales-bot-runtime.server"),
    ])
      .then(
        ([
          { runPendingPixReminders, runSubscriptionAutomation },
          { runDueBroadcasts, runDueGroupBroadcasts },
          { runDueImageBotGroupAutomations },
          { runImageBotPremiumExpiryReminders },
          { listSalesBotClones, salesBotCloneRuntime },
          { enterSalesBotRuntime, runWithSalesBotRuntime },
        ]) => {
          enterSalesBotRuntime(null);
          const runSalesAutomations = () =>
            Promise.all([
              runSubscriptionAutomation(),
              runPendingPixReminders(),
              runDueBroadcasts(localDb),
              runDueGroupBroadcasts(localDb),
            ]);
          return Promise.all([
            runSalesAutomations(),
            ...listSalesBotClones().map((clone) =>
              Promise.resolve(
                runWithSalesBotRuntime(salesBotCloneRuntime(clone), runSalesAutomations),
              ).catch((error: unknown) => {
                  console.error(`[subscription-automation:${clone.username}]`, error);
                  return null;
                }),
            ),
            runDueImageBotGroupAutomations(),
            runImageBotPremiumExpiryReminders(),
          ]);
        },
      )
      .catch((error) => console.error("[subscription-automation]", error));
  };
  const firstRun = setTimeout(run, 30_000);
  firstRun.unref?.();
  schedulerGlobal.__botVendasSubscriptionScheduler = setInterval(run, intervalMinutes * 60_000);
  schedulerGlobal.__botVendasSubscriptionScheduler.unref?.();
}
