import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { detectImageBotLanguage, type ImageBotLanguage } from "@/lib/image-bot-i18n";

export type ImageBotCategory = "hetero" | "trans";
export type ImageBotMediaType = "photo" | "video";
export type ImageBotGroupAutomationContentKind =
  | "text"
  | "custom_photo"
  | "custom_video"
  | "saved_media"
  | "telegram_message";

type ImageBotGroupSqliteRow = Omit<ImageBotGroupRow, "is_active"> & { is_active: number };
type ImageBotGroupAutomationSqliteRow = Omit<
  ImageBotGroupAutomationRow,
  "is_active" | "saved_media_is_active" | "buttons"
> & {
  is_active: number;
  saved_media_is_active: number | null;
  buttons: string;
};

const databasePath = resolve(process.env.IMAGE_BOT_DATABASE_PATH ?? "data/upmidias.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

export const imageBotSqlite = new Database(databasePath);
imageBotSqlite.pragma("journal_mode = WAL");
imageBotSqlite.pragma("foreign_keys = ON");
imageBotSqlite.pragma("synchronous = NORMAL");
imageBotSqlite.pragma("temp_store = MEMORY");
imageBotSqlite.pragma("wal_autocheckpoint = 1000");
imageBotSqlite.pragma("busy_timeout = 15000");

imageBotSqlite.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    welcome_message TEXT NOT NULL,
    welcome_image_url TEXT,
    category_hetero_label TEXT NOT NULL DEFAULT 'Hetero',
    category_trans_label TEXT NOT NULL DEFAULT 'Trans',
    photo_button_label TEXT NOT NULL DEFAULT 'Fotos',
    video_button_label TEXT NOT NULL DEFAULT 'Videos',
    random_button_label TEXT NOT NULL DEFAULT '🎬 Receba vídeos',
    back_button_label TEXT NOT NULL DEFAULT 'Voltar',
    favorites_button_label TEXT NOT NULL DEFAULT '❤️ Favoritos',
    category_prompt TEXT NOT NULL DEFAULT 'Escolha uma categoria:',
    media_prompt TEXT NOT NULL DEFAULT '<b>{{categoria}}</b> selecionado. Toque em Receba vídeos para receber uma mídia aleatória:',
    category_required_message TEXT NOT NULL DEFAULT 'Escolha primeiro uma categoria.',
    empty_media_message TEXT NOT NULL DEFAULT 'Ainda nao ha midias deste tipo.',
    favorites_empty_message TEXT NOT NULL DEFAULT 'Voce ainda nao favoritou nenhuma midia desta categoria.',
    rate_limit_message TEXT NOT NULL DEFAULT 'Voce esta pedindo muito rapido. Aguarde um instante.',
    daily_limit_message TEXT NOT NULL DEFAULT 'Voce atingiu seu limite diario de midias. Volte amanha.',
    maintenance_enabled INTEGER NOT NULL DEFAULT 0,
    maintenance_message TEXT NOT NULL DEFAULT 'Bot em manutencao. Tente novamente mais tarde.',
    flood_cooldown_seconds INTEGER NOT NULL DEFAULT 3,
    flood_limit_per_minute INTEGER NOT NULL DEFAULT 12,
    daily_media_limit INTEGER NOT NULL DEFAULT 0,
    operating_hours_enabled INTEGER NOT NULL DEFAULT 0,
    operating_start TEXT NOT NULL DEFAULT '00:00',
    operating_end TEXT NOT NULL DEFAULT '23:59',
    outside_hours_message TEXT NOT NULL DEFAULT 'Bot fechado agora. Volte no horario de funcionamento.',
    auto_message_enabled INTEGER NOT NULL DEFAULT 0,
    auto_message_every INTEGER NOT NULL DEFAULT 0,
    auto_message_text TEXT NOT NULL DEFAULT '',
    auto_message_plan_mode TEXT NOT NULL DEFAULT 'none'
      CHECK (auto_message_plan_mode IN ('none', 'all', 'single')),
    auto_message_plan_id TEXT,
    payment_enabled INTEGER NOT NULL DEFAULT 0,
    payment_hetero_price REAL NOT NULL DEFAULT 0,
    payment_trans_price REAL NOT NULL DEFAULT 0,
    payment_access_days INTEGER NOT NULL DEFAULT 30,
    payment_prompt TEXT NOT NULL DEFAULT 'Para liberar {{categoria}}, gere o Pix abaixo. Assim que o pagamento aprovar, o acesso e liberado automaticamente.',
    payment_success_message TEXT NOT NULL DEFAULT 'Pagamento confirmado! Seu acesso a {{categoria}} foi liberado.',
    limit_upgrade_enabled INTEGER NOT NULL DEFAULT 1,
    limit_upgrade_button_label TEXT NOT NULL DEFAULT 'Obtenha mais limite por {{valor}}',
    limit_upgrade_price REAL NOT NULL DEFAULT 5,
    limit_upgrade_bonus_count INTEGER NOT NULL DEFAULT 10,
    limit_upgrade_access_type TEXT NOT NULL DEFAULT 'days' CHECK (limit_upgrade_access_type IN ('days', 'lifetime')),
    limit_upgrade_access_days INTEGER NOT NULL DEFAULT 1,
    premium_expiry_warning_days INTEGER NOT NULL DEFAULT 2,
    premium_expiry_warning_message TEXT NOT NULL DEFAULT 'Seu plano {{plano}} vence em {{dias}} dias. Renove para continuar usando os beneficios.',
    premium_expiry_repeat_count INTEGER NOT NULL DEFAULT 1,
    premium_expiry_repeat_interval_minutes INTEGER NOT NULL DEFAULT 60,
    premium_offer_button_label TEXT NOT NULL DEFAULT 'Libere acesso total ao bot',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS telegram_updates (
    update_id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    telegram_chat_id INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    username TEXT,
    type TEXT NOT NULL CHECK (type IN ('group', 'supergroup')),
    category TEXT CHECK (category IN ('hetero', 'trans')),
    bot_status TEXT NOT NULL DEFAULT 'member',
    is_active INTEGER NOT NULL DEFAULT 1,
    member_count INTEGER,
    joined_at TEXT,
    left_at TEXT,
    last_activity_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS groups_active_idx
    ON groups(is_active, updated_at DESC);

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    telegram_chat_id INTEGER NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('hetero', 'trans')),
    media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
    file_id TEXT NOT NULL,
    file_unique_id TEXT NOT NULL,
    media_group_id TEXT,
    caption TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    delivery_count INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    deleted_by TEXT,
    restored_at TEXT,
    restored_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category, file_unique_id)
  );
  CREATE INDEX IF NOT EXISTS media_category_type_idx
    ON media(category, media_type, created_at DESC);

  CREATE TABLE IF NOT EXISTS delivery_limits (
    telegram_user_id INTEGER PRIMARY KEY,
    last_request_at INTEGER NOT NULL,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    last_media_id TEXT
  );

  CREATE TABLE IF NOT EXISTS interaction_limits (
    telegram_user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    last_action_at INTEGER NOT NULL,
    PRIMARY KEY (telegram_user_id, action)
  );

  CREATE TABLE IF NOT EXISTS user_navigation (
    telegram_user_id INTEGER PRIMARY KEY,
    category TEXT CHECK (category IN ('hetero', 'trans')),
    premium_message_id INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language_code TEXT,
    preferred_language TEXT,
    first_started_at TEXT,
    last_started_at TEXT,
    last_activity_at TEXT NOT NULL,
    media_delivered_count INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_blocked INTEGER NOT NULL DEFAULT 0,
    is_bot INTEGER NOT NULL DEFAULT 0,
    is_telegram_premium INTEGER NOT NULL DEFAULT 0,
    start_count INTEGER NOT NULL DEFAULT 0,
    telegram_profile_json TEXT,
    delivery_limit_per_minute INTEGER NOT NULL DEFAULT 12,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS users_started_idx
    ON users(first_started_at, last_activity_at DESC);

  CREATE TABLE IF NOT EXISTS favorites (
    telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (telegram_user_id, media_id)
  );
  CREATE INDEX IF NOT EXISTS favorites_user_idx
    ON favorites(telegram_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS media_deliveries (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
    category TEXT NOT NULL CHECK (category IN ('hetero', 'trans')),
    media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
    delivery_source TEXT NOT NULL CHECK (delivery_source IN ('photo', 'video', 'random', 'favorite')),
    delivered_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_deliveries_user_idx
    ON media_deliveries(telegram_user_id, delivered_at DESC);

  CREATE TABLE IF NOT EXISTS paid_access (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('hetero', 'trans')),
    order_id TEXT,
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(telegram_user_id, category)
  );
  CREATE INDEX IF NOT EXISTS paid_access_lookup_idx
    ON paid_access(telegram_user_id, category, expires_at);

  CREATE TABLE IF NOT EXISTS premium_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    access_type TEXT NOT NULL DEFAULT 'days' CHECK (access_type IN ('days', 'lifetime')),
    access_days INTEGER NOT NULL DEFAULT 30,
    allow_favorites INTEGER NOT NULL DEFAULT 1,
    media_cooldown_seconds INTEGER NOT NULL DEFAULT 1,
    daily_media_limit INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS premium_plans_active_idx
    ON premium_plans(is_active, price, created_at);

  CREATE TABLE IF NOT EXISTS premium_access (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL UNIQUE REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES premium_plans(id) ON DELETE SET NULL,
    order_id TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'payment')),
    starts_at TEXT NOT NULL,
    expires_at TEXT,
    granted_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS premium_access_lookup_idx
    ON premium_access(telegram_user_id, starts_at, expires_at);

  CREATE TABLE IF NOT EXISTS premium_expiry_notifications (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    premium_access_id TEXT NOT NULL REFERENCES premium_access(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    send_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(telegram_user_id, premium_access_id, expires_at)
  );
  CREATE INDEX IF NOT EXISTS premium_expiry_notifications_lookup_idx
    ON premium_expiry_notifications(telegram_user_id, expires_at);

  CREATE TABLE IF NOT EXISTS premium_payment_orders (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES premium_plans(id) ON DELETE SET NULL,
    plan_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    access_type TEXT NOT NULL CHECK (access_type IN ('days', 'lifetime')),
    access_days INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled', 'expired')),
    provider TEXT NOT NULL DEFAULT 'mercado_pago',
    provider_payment_id TEXT UNIQUE,
    pix_qr_code TEXT,
    pix_qr_code_base64 TEXT,
    pix_ticket_url TEXT,
    raw_status TEXT,
    paid_at TEXT,
    telegram_chat_id INTEGER,
    telegram_message_id INTEGER,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS premium_payment_orders_user_idx
    ON premium_payment_orders(telegram_user_id, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('hetero', 'trans')),
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled', 'expired')),
    provider TEXT NOT NULL DEFAULT 'mercado_pago',
    provider_payment_id TEXT UNIQUE,
    pix_qr_code TEXT,
    pix_qr_code_base64 TEXT,
    pix_ticket_url TEXT,
    raw_status TEXT,
    paid_at TEXT,
    telegram_chat_id INTEGER,
    telegram_message_id INTEGER,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS payment_orders_user_idx
    ON payment_orders(telegram_user_id, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS limit_payment_orders (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    amount REAL NOT NULL DEFAULT 0,
    bonus_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'canceled', 'expired')),
    provider TEXT NOT NULL DEFAULT 'mercado_pago',
    provider_payment_id TEXT UNIQUE,
    pix_qr_code TEXT,
    pix_qr_code_base64 TEXT,
    pix_ticket_url TEXT,
    raw_status TEXT,
    paid_at TEXT,
    telegram_chat_id INTEGER,
    telegram_message_id INTEGER,
    access_type TEXT NOT NULL DEFAULT 'days' CHECK (access_type IN ('days', 'lifetime')),
    access_days INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS limit_payment_orders_user_idx
    ON limit_payment_orders(telegram_user_id, status, created_at DESC);

  CREATE TABLE IF NOT EXISTS daily_limit_boosts (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    order_id TEXT REFERENCES limit_payment_orders(id) ON DELETE SET NULL,
    bonus_count INTEGER NOT NULL DEFAULT 0,
    valid_on TEXT NOT NULL,
    starts_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS daily_limit_boosts_user_day_idx
    ON daily_limit_boosts(telegram_user_id, valid_on);
  CREATE UNIQUE INDEX IF NOT EXISTS daily_limit_boosts_order_idx
    ON daily_limit_boosts(order_id) WHERE order_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS admin_permissions (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL UNIQUE REFERENCES users(telegram_user_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'moderator', 'viewer')),
    can_delete_media INTEGER NOT NULL DEFAULT 0,
    can_restore_media INTEGER NOT NULL DEFAULT 0,
    can_manage_users INTEGER NOT NULL DEFAULT 0,
    can_manage_settings INTEGER NOT NULL DEFAULT 0,
    can_view_stats INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS audit_logs_created_idx
    ON audit_logs(created_at DESC);

  CREATE TABLE IF NOT EXISTS telegram_errors (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    chat_id TEXT,
    telegram_user_id INTEGER,
    error_message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS telegram_errors_created_idx
    ON telegram_errors(created_at DESC);

  CREATE TABLE IF NOT EXISTS group_automations (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    content_kind TEXT NOT NULL DEFAULT 'text'
      CHECK (content_kind IN ('text', 'custom_photo', 'custom_video', 'saved_media', 'telegram_message')),
    custom_media_url TEXT,
    saved_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
    random_media_category TEXT CHECK (random_media_category IN ('hetero', 'trans')),
    media_batch_size INTEGER NOT NULL DEFAULT 1,
    source_chat_id INTEGER,
    source_message_id INTEGER,
    buttons TEXT NOT NULL DEFAULT '[]',
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT,
    locked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS group_automations_due_idx
    ON group_automations(is_active, group_id, last_sent_at);

  CREATE TABLE IF NOT EXISTS group_automation_media_history (
    automation_id TEXT NOT NULL REFERENCES group_automations(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (automation_id, media_id)
  );
  CREATE INDEX IF NOT EXISTS group_automation_media_history_sent_idx
    ON group_automation_media_history(automation_id, sent_at DESC);
`);

imageBotSqlite.exec(`
  INSERT OR IGNORE INTO users
    (id, telegram_user_id, first_started_at, last_started_at, last_activity_at, created_at, updated_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
         substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' ||
         lower(hex(randomblob(6))),
         telegram_user_id,
         datetime(updated_at / 1000, 'unixepoch'),
         datetime(updated_at / 1000, 'unixepoch'),
         datetime(updated_at / 1000, 'unixepoch'),
         datetime(updated_at / 1000, 'unixepoch'),
         datetime(updated_at / 1000, 'unixepoch')
  FROM user_navigation;
`);

const mediaColumns = imageBotSqlite.prepare("PRAGMA table_info(media)").all() as { name: string }[];
if (!mediaColumns.some((column) => column.name === "media_group_id")) {
  imageBotSqlite.exec("ALTER TABLE media ADD COLUMN media_group_id TEXT");
}
if (!mediaColumns.some((column) => column.name === "is_active")) {
  imageBotSqlite.exec("ALTER TABLE media ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
}
if (!mediaColumns.some((column) => column.name === "delivery_count")) {
  imageBotSqlite.exec("ALTER TABLE media ADD COLUMN delivery_count INTEGER NOT NULL DEFAULT 0");
}
if (!mediaColumns.some((column) => column.name === "deleted_at")) {
  imageBotSqlite.exec("ALTER TABLE media ADD COLUMN deleted_at TEXT");
}
if (!mediaColumns.some((column) => column.name === "deleted_by")) {
  imageBotSqlite.exec("ALTER TABLE media ADD COLUMN deleted_by TEXT");
}
if (!mediaColumns.some((column) => column.name === "restored_at")) {
  imageBotSqlite.exec("ALTER TABLE media ADD COLUMN restored_at TEXT");
}
if (!mediaColumns.some((column) => column.name === "restored_by")) {
  imageBotSqlite.exec("ALTER TABLE media ADD COLUMN restored_by TEXT");
}
imageBotSqlite.exec(
  "CREATE INDEX IF NOT EXISTS media_album_idx ON media(media_group_id, created_at DESC)",
);
const navigationColumns = imageBotSqlite.prepare("PRAGMA table_info(user_navigation)").all() as {
  name: string;
}[];
if (!navigationColumns.some((column) => column.name === "premium_message_id")) {
  imageBotSqlite.exec("ALTER TABLE user_navigation ADD COLUMN premium_message_id INTEGER");
}
imageBotSqlite.exec(
  "CREATE INDEX IF NOT EXISTS media_active_lookup_idx ON media(category, is_active, deleted_at, media_type, id)",
);
imageBotSqlite.exec(
  "CREATE INDEX IF NOT EXISTS media_created_active_idx ON media(deleted_at, is_active, created_at DESC)",
);

const userColumns = imageBotSqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userColumns.some((column) => column.name === "is_admin")) {
  imageBotSqlite.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.some((column) => column.name === "is_blocked")) {
  imageBotSqlite.exec("ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.some((column) => column.name === "delivery_limit_per_minute")) {
  imageBotSqlite.exec(
    "ALTER TABLE users ADD COLUMN delivery_limit_per_minute INTEGER NOT NULL DEFAULT 12",
  );
}
if (!userColumns.some((column) => column.name === "is_bot")) {
  imageBotSqlite.exec("ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.some((column) => column.name === "is_telegram_premium")) {
  imageBotSqlite.exec(
    "ALTER TABLE users ADD COLUMN is_telegram_premium INTEGER NOT NULL DEFAULT 0",
  );
}
if (!userColumns.some((column) => column.name === "start_count")) {
  imageBotSqlite.exec("ALTER TABLE users ADD COLUMN start_count INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.some((column) => column.name === "telegram_profile_json")) {
  imageBotSqlite.exec("ALTER TABLE users ADD COLUMN telegram_profile_json TEXT");
}

const settingDefaults = [
  ["category_hetero_label", "TEXT NOT NULL", "Hetero"],
  ["category_trans_label", "TEXT NOT NULL", "Trans"],
  ["photo_button_label", "TEXT NOT NULL", "Fotos"],
  ["video_button_label", "TEXT NOT NULL", "Videos"],
  ["random_button_label", "TEXT NOT NULL", "🎬 Receba vídeos"],
  ["back_button_label", "TEXT NOT NULL", "Voltar"],
  ["favorites_button_label", "TEXT NOT NULL", "❤️ Favoritos"],
  ["category_prompt", "TEXT NOT NULL", "Escolha uma categoria:"],
  [
    "media_prompt",
    "TEXT NOT NULL",
    "<b>{{categoria}}</b> selecionado. Toque em Receba vídeos para receber uma mídia aleatória:",
  ],
  ["category_required_message", "TEXT NOT NULL", "Escolha primeiro uma categoria."],
  ["empty_media_message", "TEXT NOT NULL", "Ainda nao ha midias deste tipo."],
  [
    "favorites_empty_message",
    "TEXT NOT NULL",
    "Voce ainda nao favoritou nenhuma midia desta categoria.",
  ],
  ["rate_limit_message", "TEXT NOT NULL", "Voce esta pedindo muito rapido. Aguarde um instante."],
  [
    "daily_limit_message",
    "TEXT NOT NULL",
    "Voce atingiu seu limite diario de midias. Volte amanha.",
  ],
  ["maintenance_enabled", "INTEGER NOT NULL", 0],
  ["maintenance_message", "TEXT NOT NULL", "Bot em manutencao. Tente novamente mais tarde."],
  ["flood_cooldown_seconds", "INTEGER NOT NULL", 3],
  ["flood_limit_per_minute", "INTEGER NOT NULL", 12],
  ["daily_media_limit", "INTEGER NOT NULL", 0],
  ["operating_hours_enabled", "INTEGER NOT NULL", 0],
  ["operating_start", "TEXT NOT NULL", "00:00"],
  ["operating_end", "TEXT NOT NULL", "23:59"],
  [
    "outside_hours_message",
    "TEXT NOT NULL",
    "Bot fechado agora. Volte no horario de funcionamento.",
  ],
  ["auto_message_enabled", "INTEGER NOT NULL", 0],
  ["auto_message_every", "INTEGER NOT NULL", 0],
  ["auto_message_text", "TEXT NOT NULL", ""],
  ["payment_enabled", "INTEGER NOT NULL", 0],
  ["payment_hetero_price", "REAL NOT NULL", 0],
  ["payment_trans_price", "REAL NOT NULL", 0],
  ["payment_access_days", "INTEGER NOT NULL", 30],
  [
    "payment_prompt",
    "TEXT NOT NULL",
    "Para liberar {{categoria}}, gere o Pix abaixo. Assim que o pagamento aprovar, o acesso e liberado automaticamente.",
  ],
  [
    "payment_success_message",
    "TEXT NOT NULL",
    "Pagamento confirmado! Seu acesso a {{categoria}} foi liberado.",
  ],
  ["limit_upgrade_enabled", "INTEGER NOT NULL", 1],
  ["limit_upgrade_button_label", "TEXT NOT NULL", "Obtenha mais limite por {{valor}}"],
  ["limit_upgrade_price", "REAL NOT NULL", 5],
  ["limit_upgrade_bonus_count", "INTEGER NOT NULL", 10],
  ["limit_upgrade_access_type", "TEXT NOT NULL", "days"],
  ["limit_upgrade_access_days", "INTEGER NOT NULL", 1],
  ["premium_expiry_warning_days", "INTEGER NOT NULL", 2],
  [
    "premium_expiry_warning_message",
    "TEXT NOT NULL",
    "Seu plano {{plano}} vence em {{dias}} dias. Renove para continuar usando os beneficios.",
  ],
  ["premium_expiry_repeat_count", "INTEGER NOT NULL", 1],
  ["premium_expiry_repeat_interval_minutes", "INTEGER NOT NULL", 60],
  ["premium_offer_button_label", "TEXT NOT NULL", "Libere acesso total ao bot"],
] as const;

const settingsColumns = imageBotSqlite.prepare("PRAGMA table_info(settings)").all() as {
  name: string;
}[];
for (const [name, type, defaultValue] of settingDefaults) {
  if (settingsColumns.some((column) => column.name === name)) continue;
  const sqlDefault =
    typeof defaultValue === "number"
      ? String(defaultValue)
      : `'${defaultValue.replaceAll("'", "''")}'`;
  imageBotSqlite.exec(`ALTER TABLE settings ADD COLUMN ${name} ${type} DEFAULT ${sqlDefault}`);
}

function addMissingColumn(table: string, column: string, definition: string) {
  const columns = imageBotSqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((item) => item.name === column)) return;
  imageBotSqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addMissingColumn("payment_orders", "expires_at", "TEXT");
addMissingColumn("limit_payment_orders", "access_type", "TEXT NOT NULL DEFAULT 'days'");
addMissingColumn("limit_payment_orders", "access_days", "INTEGER NOT NULL DEFAULT 1");
addMissingColumn("limit_payment_orders", "expires_at", "TEXT");
addMissingColumn("daily_limit_boosts", "starts_at", "TEXT");
addMissingColumn("daily_limit_boosts", "expires_at", "TEXT");
addMissingColumn("premium_plans", "allow_favorites", "INTEGER NOT NULL DEFAULT 1");
addMissingColumn("premium_plans", "media_cooldown_seconds", "INTEGER NOT NULL DEFAULT 1");
addMissingColumn("premium_plans", "daily_media_limit", "INTEGER NOT NULL DEFAULT 0");
addMissingColumn("premium_expiry_notifications", "send_count", "INTEGER NOT NULL DEFAULT 1");
addMissingColumn("settings", "auto_message_plan_mode", "TEXT NOT NULL DEFAULT 'none'");
addMissingColumn("settings", "auto_message_plan_id", "TEXT");
addMissingColumn("group_automations", "buttons", "TEXT NOT NULL DEFAULT '[]'");
addMissingColumn("users", "preferred_language", "TEXT");
imageBotSqlite.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS daily_limit_boosts_order_idx ON daily_limit_boosts(order_id) WHERE order_id IS NOT NULL",
);

const groupAutomationColumns = imageBotSqlite
  .prepare("PRAGMA table_info(group_automations)")
  .all() as { name: string }[];
if (!groupAutomationColumns.some((column) => column.name === "random_media_category")) {
  imageBotSqlite.exec(
    "ALTER TABLE group_automations ADD COLUMN random_media_category TEXT CHECK (random_media_category IN ('hetero', 'trans'))",
  );
}
if (!groupAutomationColumns.some((column) => column.name === "media_batch_size")) {
  imageBotSqlite.exec(
    "ALTER TABLE group_automations ADD COLUMN media_batch_size INTEGER NOT NULL DEFAULT 1",
  );
}

imageBotSqlite
  .prepare(
    `INSERT OR IGNORE INTO settings (id, welcome_message, welcome_image_url)
     VALUES (?, ?, NULL)`,
  )
  .run(
    "00000000-0000-4000-8000-000000000002",
    "Bem-vindo(a)! Use os botões abaixo para receber suas imagens.",
  );

imageBotSqlite
  .prepare(
    `UPDATE settings
     SET random_button_label = '🎬 Receba vídeos'
     WHERE random_button_label IN (
       'Aleatorio',
       'Aleatório',
       'Midias',
       'Mídias',
       '🎲 Mídias',
       'Receba videos',
       'Receba vídeos'
     )`,
  )
  .run();
imageBotSqlite
  .prepare(
    `UPDATE settings
     SET favorites_button_label = '❤️ Favoritos'
     WHERE favorites_button_label IN ('Favoritos')`,
  )
  .run();
imageBotSqlite
  .prepare(
    `UPDATE settings
     SET media_prompt = '<b>{{categoria}}</b> selecionado. Toque em Receba vídeos para receber uma mídia aleatória:'
     WHERE media_prompt IN (
       '<b>{{categoria}}</b> selecionado. Escolha o tipo de midia:',
       '<b>{{categoria}}</b> selecionado. Escolha o tipo de mídia:',
       '<b>{{categoria}}</b> selecionado. Toque em Midias para receber uma foto ou video aleatorio:',
       '<b>{{categoria}}</b> selecionado. Toque em Mídias para receber uma foto ou vídeo aleatório:'
     )`,
  )
  .run();

imageBotSqlite
  .prepare(
    `INSERT INTO premium_plans
     (id, name, description, price, access_type, access_days, is_active, created_at, updated_at)
     SELECT ?, ?, ?, ?, 'days', 30, 1, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM premium_plans)`,
  )
  .run(
    "00000000-0000-4000-8000-000000000003",
    "Premium 30 dias",
    "Libera favoritos e os recursos Premium do UpMidias.",
    5,
    new Date().toISOString(),
    new Date().toISOString(),
  );

export function claimImageBotTelegramUpdate(updateId: number) {
  const result = imageBotSqlite
    .prepare("INSERT OR IGNORE INTO telegram_updates (update_id, created_at) VALUES (?, ?)")
    .run(updateId, Date.now());
  return result.changes > 0;
}

export function categoryFromGroupTitle(title: string): ImageBotCategory | null {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.includes("hetero")) return "hetero";
  if (normalized.includes("trans")) return "trans";
  return null;
}

export type ImageBotSettingsRow = {
  id: string;
  welcome_message: string;
  welcome_image_url: string | null;
  category_hetero_label: string;
  category_trans_label: string;
  photo_button_label: string;
  video_button_label: string;
  random_button_label: string;
  back_button_label: string;
  favorites_button_label: string;
  category_prompt: string;
  media_prompt: string;
  category_required_message: string;
  empty_media_message: string;
  favorites_empty_message: string;
  rate_limit_message: string;
  daily_limit_message: string;
  maintenance_enabled: boolean;
  maintenance_message: string;
  flood_cooldown_seconds: number;
  flood_limit_per_minute: number;
  daily_media_limit: number;
  operating_hours_enabled: boolean;
  operating_start: string;
  operating_end: string;
  outside_hours_message: string;
  auto_message_enabled: boolean;
  auto_message_every: number;
  auto_message_text: string;
  auto_message_plan_mode: "none" | "all" | "single";
  auto_message_plan_id: string | null;
  payment_enabled: boolean;
  payment_hetero_price: number;
  payment_trans_price: number;
  payment_access_days: number;
  payment_prompt: string;
  payment_success_message: string;
  limit_upgrade_enabled: boolean;
  limit_upgrade_button_label: string;
  limit_upgrade_price: number;
  limit_upgrade_bonus_count: number;
  limit_upgrade_access_type: "days" | "lifetime";
  limit_upgrade_access_days: number;
  premium_expiry_warning_days: number;
  premium_expiry_warning_message: string;
  premium_expiry_repeat_count: number;
  premium_expiry_repeat_interval_minutes: number;
  premium_offer_button_label: string;
  created_at: string;
  updated_at: string;
};

type ImageBotSettingsSqliteRow = Omit<
  ImageBotSettingsRow,
  | "maintenance_enabled"
  | "operating_hours_enabled"
  | "auto_message_enabled"
  | "payment_enabled"
  | "limit_upgrade_enabled"
> & {
  maintenance_enabled: number;
  operating_hours_enabled: number;
  auto_message_enabled: number;
  payment_enabled: number;
  limit_upgrade_enabled: number;
};

function normalizeImageBotSettings(row: ImageBotSettingsSqliteRow): ImageBotSettingsRow {
  return {
    ...row,
    maintenance_enabled: Boolean(row.maintenance_enabled),
    operating_hours_enabled: Boolean(row.operating_hours_enabled),
    auto_message_enabled: Boolean(row.auto_message_enabled),
    payment_enabled: Boolean(row.payment_enabled),
    limit_upgrade_enabled: Boolean(row.limit_upgrade_enabled),
  };
}

export function getImageBotSettings(): ImageBotSettingsRow {
  return normalizeImageBotSettings(
    imageBotSqlite.prepare("SELECT * FROM settings LIMIT 1").get() as ImageBotSettingsSqliteRow,
  );
}

export function updateImageBotSettings(
  input: {
    id: string;
  } & Partial<Omit<ImageBotSettingsRow, "id" | "created_at" | "updated_at">>,
) {
  const current = getImageBotSettings();
  const next = { ...current, ...input };
  const bool = (value: boolean) => (value ? 1 : 0);
  imageBotSqlite
    .prepare(
      `UPDATE settings
       SET welcome_message = ?,
           welcome_image_url = ?,
           category_hetero_label = ?,
           category_trans_label = ?,
           photo_button_label = ?,
           video_button_label = ?,
           random_button_label = ?,
           back_button_label = ?,
           favorites_button_label = ?,
           category_prompt = ?,
           media_prompt = ?,
           category_required_message = ?,
           empty_media_message = ?,
           favorites_empty_message = ?,
           rate_limit_message = ?,
           daily_limit_message = ?,
           maintenance_enabled = ?,
           maintenance_message = ?,
           flood_cooldown_seconds = ?,
           flood_limit_per_minute = ?,
           daily_media_limit = ?,
           operating_hours_enabled = ?,
           operating_start = ?,
           operating_end = ?,
           outside_hours_message = ?,
           auto_message_enabled = ?,
           auto_message_every = ?,
           auto_message_text = ?,
           auto_message_plan_mode = ?,
           auto_message_plan_id = ?,
           payment_enabled = ?,
           payment_hetero_price = ?,
           payment_trans_price = ?,
           payment_access_days = ?,
           payment_prompt = ?,
           payment_success_message = ?,
           limit_upgrade_enabled = ?,
           limit_upgrade_button_label = ?,
           limit_upgrade_price = ?,
           limit_upgrade_bonus_count = ?,
           limit_upgrade_access_type = ?,
           limit_upgrade_access_days = ?,
           premium_expiry_warning_days = ?,
           premium_expiry_warning_message = ?,
           premium_expiry_repeat_count = ?,
           premium_expiry_repeat_interval_minutes = ?,
           premium_offer_button_label = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.welcome_message,
      next.welcome_image_url,
      next.category_hetero_label,
      next.category_trans_label,
      next.photo_button_label,
      next.video_button_label,
      next.random_button_label,
      next.back_button_label,
      next.favorites_button_label,
      next.category_prompt,
      next.media_prompt,
      next.category_required_message,
      next.empty_media_message,
      next.favorites_empty_message,
      next.rate_limit_message,
      next.daily_limit_message,
      bool(next.maintenance_enabled),
      next.maintenance_message,
      next.flood_cooldown_seconds,
      next.flood_limit_per_minute,
      next.daily_media_limit,
      bool(next.operating_hours_enabled),
      next.operating_start,
      next.operating_end,
      next.outside_hours_message,
      bool(next.auto_message_enabled),
      next.auto_message_every,
      next.auto_message_text,
      next.auto_message_plan_mode,
      next.auto_message_plan_id,
      bool(next.payment_enabled),
      next.payment_hetero_price,
      next.payment_trans_price,
      next.payment_access_days,
      next.payment_prompt,
      next.payment_success_message,
      bool(next.limit_upgrade_enabled),
      next.limit_upgrade_button_label,
      next.limit_upgrade_price,
      next.limit_upgrade_bonus_count,
      next.limit_upgrade_access_type,
      next.limit_upgrade_access_days,
      next.premium_expiry_warning_days,
      next.premium_expiry_warning_message,
      next.premium_expiry_repeat_count,
      next.premium_expiry_repeat_interval_minutes,
      next.premium_offer_button_label,
      new Date().toISOString(),
      input.id,
    );
}

export type ImageBotPremiumPlanRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  access_type: "days" | "lifetime";
  access_days: number;
  allow_favorites: boolean;
  media_cooldown_seconds: number;
  daily_media_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ImageBotPremiumPlanSqliteRow = Omit<
  ImageBotPremiumPlanRow,
  "allow_favorites" | "is_active"
> & {
  allow_favorites: number;
  is_active: number;
};

function normalizeImageBotPremiumPlan(row: ImageBotPremiumPlanSqliteRow): ImageBotPremiumPlanRow {
  return {
    ...row,
    allow_favorites: Boolean(row.allow_favorites),
    media_cooldown_seconds: Math.max(0, Math.trunc(Number(row.media_cooldown_seconds || 0))),
    daily_media_limit: Math.max(0, Math.trunc(Number(row.daily_media_limit || 0))),
    is_active: Boolean(row.is_active),
  };
}

export function getImageBotPremiumPlans(options: { activeOnly?: boolean } = {}) {
  const rows = imageBotSqlite
    .prepare(
      `SELECT *
       FROM premium_plans
       ${options.activeOnly ? "WHERE is_active = 1 AND price > 0" : ""}
       ORDER BY is_active DESC, price ASC, created_at ASC`,
    )
    .all() as ImageBotPremiumPlanSqliteRow[];
  return rows.map(normalizeImageBotPremiumPlan);
}

export function getImageBotPremiumPlan(id: string) {
  const row = imageBotSqlite.prepare("SELECT * FROM premium_plans WHERE id = ?").get(id) as
    | ImageBotPremiumPlanSqliteRow
    | undefined;
  return row ? normalizeImageBotPremiumPlan(row) : null;
}

export function saveImageBotPremiumPlan(input: {
  id?: string;
  name: string;
  description?: string | null;
  price: number;
  accessType: "days" | "lifetime";
  accessDays: number;
  allowFavorites?: boolean;
  mediaCooldownSeconds?: number;
  dailyMediaLimit?: number;
  isActive: boolean;
  actor?: string | null;
}) {
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  imageBotSqlite
    .prepare(
      `INSERT INTO premium_plans
       (id, name, description, price, access_type, access_days, allow_favorites,
        media_cooldown_seconds, daily_media_limit, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         price = excluded.price,
         access_type = excluded.access_type,
         access_days = excluded.access_days,
         allow_favorites = excluded.allow_favorites,
         media_cooldown_seconds = excluded.media_cooldown_seconds,
         daily_media_limit = excluded.daily_media_limit,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.name,
      input.description || null,
      input.price,
      input.accessType,
      input.accessType === "lifetime" ? 0 : Math.max(1, input.accessDays),
      input.allowFavorites === false ? 0 : 1,
      Math.max(0, Math.trunc(input.mediaCooldownSeconds ?? 1)),
      Math.max(0, Math.trunc(input.dailyMediaLimit ?? 0)),
      input.isActive ? 1 : 0,
      now,
      now,
    );
  recordImageBotAuditLog({
    actorType: "panel",
    actorId: input.actor ?? null,
    action: input.id ? "premium_plan.update" : "premium_plan.create",
    entityType: "premium_plan",
    entityId: id,
  });
  return getImageBotPremiumPlan(id)!;
}

export function deleteImageBotPremiumPlan(id: string, actor?: string | null) {
  const result = imageBotSqlite
    .prepare("UPDATE premium_plans SET is_active = 0, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  if (result.changes) {
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: actor ?? null,
      action: "premium_plan.delete",
      entityType: "premium_plan",
      entityId: id,
    });
  }
  return result.changes > 0;
}

export function hasActiveImageBotPremiumAccess(telegramUserId: number) {
  const now = new Date().toISOString();
  const row = imageBotSqlite
    .prepare(
      `SELECT (
         EXISTS(
           SELECT 1 FROM premium_access
           WHERE telegram_user_id = ?
             AND starts_at <= ?
             AND (expires_at IS NULL OR expires_at > ?)
         )
         OR EXISTS(
           SELECT 1 FROM paid_access
           WHERE telegram_user_id = ? AND expires_at > ?
         )
         OR EXISTS(
           SELECT 1 FROM daily_limit_boosts
           WHERE telegram_user_id = ?
             AND starts_at <= ?
             AND (expires_at IS NULL OR expires_at > ?)
         )
       ) AS active`,
    )
    .get(telegramUserId, now, now, telegramUserId, now, telegramUserId, now, now) as {
    active: number;
  };
  return Boolean(row.active);
}

export function getImageBotPremiumFeatures(telegramUserId: number) {
  const now = new Date().toISOString();
  const row = imageBotSqlite
    .prepare(
      `SELECT premium_access.plan_id,
              premium_plans.allow_favorites,
              premium_plans.media_cooldown_seconds,
              premium_plans.daily_media_limit
       FROM premium_access
       LEFT JOIN premium_plans ON premium_plans.id = premium_access.plan_id
       WHERE premium_access.telegram_user_id = ?
         AND premium_access.starts_at <= ?
         AND (premium_access.expires_at IS NULL OR premium_access.expires_at > ?)
       LIMIT 1`,
    )
    .get(telegramUserId, now, now) as
    | {
        plan_id: string | null;
        allow_favorites: number | null;
        media_cooldown_seconds: number | null;
        daily_media_limit: number | null;
      }
    | undefined;

  if (!row) {
    return {
      active: false,
      allow_favorites: false,
      media_cooldown_seconds: null,
      daily_media_limit: null,
      plan_id: null,
    };
  }

  return {
    active: true,
    allow_favorites: row.allow_favorites === null ? true : Boolean(row.allow_favorites),
    media_cooldown_seconds:
      row.media_cooldown_seconds === null
        ? null
        : Math.max(0, Math.trunc(Number(row.media_cooldown_seconds))),
    daily_media_limit:
      row.daily_media_limit === null
        ? null
        : Math.max(0, Math.trunc(Number(row.daily_media_limit))),
    plan_id: row.plan_id,
  };
}

export function hasImageBotFavoriteAccess(telegramUserId: number) {
  const features = getImageBotPremiumFeatures(telegramUserId);
  return features.active && features.allow_favorites;
}

export function hasLifetimeImageBotPremiumAccess(telegramUserId: number) {
  const now = new Date().toISOString();
  const row = imageBotSqlite
    .prepare(
      `SELECT 1 AS active
       FROM premium_access
       WHERE telegram_user_id = ?
         AND starts_at <= ?
         AND expires_at IS NULL
       LIMIT 1`,
    )
    .get(telegramUserId, now) as { active: number } | undefined;
  return Boolean(row?.active);
}

export function grantImageBotPremiumAccess(input: {
  telegramUserId: number;
  planId: string;
  source: "manual" | "payment";
  orderId?: string | null;
  actor?: string | null;
}) {
  const plan = getImageBotPremiumPlan(input.planId);
  if (!plan) throw new Error("Plano Premium nao encontrado");
  const now = new Date();
  const nowIso = now.toISOString();
  const current = imageBotSqlite
    .prepare("SELECT expires_at FROM premium_access WHERE telegram_user_id = ?")
    .get(input.telegramUserId) as { expires_at: string | null } | undefined;
  const expiresAt =
    plan.access_type === "lifetime" || current?.expires_at === null
      ? null
      : new Date(
          Math.max(now.getTime(), current?.expires_at ? Date.parse(current.expires_at) : 0) +
            Math.max(1, plan.access_days) * 86_400_000,
        ).toISOString();
  imageBotSqlite
    .prepare(
      `INSERT INTO premium_access
       (id, telegram_user_id, plan_id, order_id, source, starts_at, expires_at, granted_by,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         plan_id = excluded.plan_id,
         order_id = excluded.order_id,
         source = excluded.source,
         starts_at = excluded.starts_at,
         expires_at = excluded.expires_at,
         granted_by = excluded.granted_by,
         updated_at = excluded.updated_at`,
    )
    .run(
      randomUUID(),
      input.telegramUserId,
      plan.id,
      input.orderId ?? null,
      input.source,
      nowIso,
      expiresAt,
      input.actor ?? null,
      nowIso,
      nowIso,
    );
  recordImageBotAuditLog({
    actorType: input.source === "manual" ? "panel" : "system",
    actorId: input.actor ?? null,
    action: "premium_access.grant",
    entityType: "user",
    entityId: String(input.telegramUserId),
    details: JSON.stringify({ plan_id: plan.id, expires_at: expiresAt, source: input.source }),
  });
  return { plan, expiresAt };
}

export type ImageBotPremiumExpiryReminderRow = {
  premium_access_id: string;
  telegram_user_id: number;
  first_name: string | null;
  plan_id: string | null;
  plan_name: string;
  expires_at: string;
};

export function getDueImageBotPremiumExpiryReminders(now = new Date()) {
  const settings = getImageBotSettings();
  const warningDays = Math.max(1, Math.trunc(settings.premium_expiry_warning_days || 2));
  const repeatCount = Math.min(
    10,
    Math.max(1, Math.trunc(settings.premium_expiry_repeat_count || 1)),
  );
  const repeatIntervalMinutes = Math.max(
    1,
    Math.trunc(settings.premium_expiry_repeat_interval_minutes || 60),
  );
  const nowIso = now.toISOString();
  const warningEndIso = new Date(now.getTime() + warningDays * 86_400_000).toISOString();
  const repeatCutoffIso = new Date(now.getTime() - repeatIntervalMinutes * 60_000).toISOString();
  return imageBotSqlite
    .prepare(
      `SELECT premium_access.id AS premium_access_id,
              premium_access.telegram_user_id,
              users.first_name,
              premium_access.plan_id,
              COALESCE(premium_plans.name, 'Premium') AS plan_name,
              premium_access.expires_at
       FROM premium_access
       JOIN users ON users.telegram_user_id = premium_access.telegram_user_id
       LEFT JOIN premium_plans ON premium_plans.id = premium_access.plan_id
       LEFT JOIN premium_expiry_notifications
         ON premium_expiry_notifications.telegram_user_id = premium_access.telegram_user_id
        AND premium_expiry_notifications.premium_access_id = premium_access.id
        AND premium_expiry_notifications.expires_at = premium_access.expires_at
       WHERE premium_access.starts_at <= ?
         AND premium_access.expires_at IS NOT NULL
         AND premium_access.expires_at > ?
         AND premium_access.expires_at <= ?
         AND users.is_blocked = 0
         AND users.is_bot = 0
         AND COALESCE(premium_expiry_notifications.send_count, 0) < ?
         AND (
           premium_expiry_notifications.sent_at IS NULL
           OR premium_expiry_notifications.sent_at <= ?
         )
       ORDER BY premium_access.expires_at ASC
       LIMIT 100`,
    )
    .all(
      nowIso,
      nowIso,
      warningEndIso,
      repeatCount,
      repeatCutoffIso,
    ) as ImageBotPremiumExpiryReminderRow[];
}

export function markImageBotPremiumExpiryReminderSent(
  reminder: Pick<
    ImageBotPremiumExpiryReminderRow,
    "premium_access_id" | "telegram_user_id" | "expires_at"
  >,
  sentAt = new Date(),
) {
  return (
    imageBotSqlite
      .prepare(
        `INSERT INTO premium_expiry_notifications
         (id, telegram_user_id, premium_access_id, expires_at, sent_at, send_count, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(telegram_user_id, premium_access_id, expires_at) DO UPDATE SET
           sent_at = excluded.sent_at,
           send_count = premium_expiry_notifications.send_count + 1`,
      )
      .run(
        randomUUID(),
        reminder.telegram_user_id,
        reminder.premium_access_id,
        reminder.expires_at,
        sentAt.toISOString(),
        sentAt.toISOString(),
      ).changes > 0
  );
}

export function releaseImageBotPremiumExpiryReminder(
  reminder: Pick<
    ImageBotPremiumExpiryReminderRow,
    "premium_access_id" | "telegram_user_id" | "expires_at"
  >,
) {
  const release = imageBotSqlite.transaction(() => {
    imageBotSqlite
      .prepare(
        `UPDATE premium_expiry_notifications
         SET send_count = send_count - 1,
             sent_at = '1970-01-01T00:00:00.000Z'
         WHERE telegram_user_id = ? AND premium_access_id = ? AND expires_at = ?`,
      )
      .run(reminder.telegram_user_id, reminder.premium_access_id, reminder.expires_at);
    imageBotSqlite
      .prepare(
        `DELETE FROM premium_expiry_notifications
         WHERE telegram_user_id = ? AND premium_access_id = ? AND expires_at = ?
           AND send_count <= 0`,
      )
      .run(reminder.telegram_user_id, reminder.premium_access_id, reminder.expires_at);
  });
  release();
}

export function revokeAllImageBotPremiumAccess(telegramUserId: number, actor?: string | null) {
  const revoke = imageBotSqlite.transaction(() => {
    const premium = imageBotSqlite
      .prepare("DELETE FROM premium_access WHERE telegram_user_id = ?")
      .run(telegramUserId).changes;
    const categories = imageBotSqlite
      .prepare("DELETE FROM paid_access WHERE telegram_user_id = ?")
      .run(telegramUserId).changes;
    const boosts = imageBotSqlite
      .prepare("DELETE FROM daily_limit_boosts WHERE telegram_user_id = ?")
      .run(telegramUserId).changes;
    return premium + categories + boosts;
  });
  const changes = revoke();
  if (changes) {
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: actor ?? null,
      action: "premium_access.revoke",
      entityType: "user",
      entityId: String(telegramUserId),
    });
  }
  return changes > 0;
}

export type ImageBotGroupInput = {
  telegramChatId: number;
  title: string;
  username?: string | null;
  type: "group" | "supergroup";
  botStatus?: string;
  isActive?: boolean;
  memberCount?: number | null;
  activityAt?: string;
};

export type ImageBotGroupRow = {
  id: string;
  telegram_chat_id: number;
  title: string;
  username: string | null;
  type: "group" | "supergroup";
  category: ImageBotCategory | null;
  bot_status: string;
  is_active: boolean;
  member_count: number | null;
  joined_at: string | null;
  left_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
};

export function upsertImageBotGroup(input: ImageBotGroupInput) {
  const now = input.activityAt ?? new Date().toISOString();
  const existing = imageBotSqlite
    .prepare("SELECT * FROM groups WHERE telegram_chat_id = ?")
    .get(input.telegramChatId) as ImageBotGroupSqliteRow | undefined;
  const isActive = input.isActive ?? (existing ? Boolean(existing.is_active) : true);
  const botStatus = input.botStatus ?? (existing?.is_active ? existing.bot_status : "member");
  const joinedAt =
    isActive && (!existing || !existing.is_active) ? now : (existing?.joined_at ?? now);
  const category = categoryFromGroupTitle(input.title) ?? existing?.category ?? null;

  imageBotSqlite
    .prepare(
      `INSERT INTO groups
       (id, telegram_chat_id, title, username, type, category, bot_status, is_active,
        member_count, joined_at, left_at, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_chat_id) DO UPDATE SET
         title = excluded.title,
         username = excluded.username,
         type = excluded.type,
         category = excluded.category,
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
      category,
      botStatus,
      isActive ? 1 : 0,
      input.memberCount ?? existing?.member_count ?? null,
      joinedAt,
      isActive ? null : now,
      now,
      existing?.created_at ?? now,
      now,
    );

  return getImageBotGroups().find((group) => group.telegram_chat_id === input.telegramChatId);
}

export function getImageBotGroups(): ImageBotGroupRow[] {
  return (
    imageBotSqlite
      .prepare(
        `SELECT * FROM groups
         ORDER BY is_active DESC, COALESCE(last_activity_at, updated_at) DESC`,
      )
      .all() as ImageBotGroupSqliteRow[]
  ).map((row) => ({ ...row, is_active: Boolean(row.is_active) }) as ImageBotGroupRow);
}

export type ImageBotGroupAutomationRow = {
  id: string;
  group_id: string;
  title: string;
  message: string;
  content_kind: ImageBotGroupAutomationContentKind;
  custom_media_url: string | null;
  saved_media_id: string | null;
  random_media_category: ImageBotCategory | null;
  media_batch_size: number;
  source_chat_id: number | null;
  source_message_id: number | null;
  buttons: ImageBotAutomationPlanButton[];
  interval_minutes: number;
  is_active: boolean;
  last_sent_at: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  saved_media_category: ImageBotCategory | null;
  saved_media_type: ImageBotMediaType | null;
  saved_media_file_id: string | null;
  saved_media_caption: string | null;
  saved_media_is_active: boolean | null;
};

export type ImageBotAutomationPlanButton = {
  label: string;
  kind: "premium_plans" | "premium_plan" | "bot_link";
  plan_id?: string | null;
  url?: string | null;
};

export type ImageBotGroupAutomationInput = {
  id?: string;
  groupId: string;
  title: string;
  message: string;
  contentKind: ImageBotGroupAutomationContentKind;
  customMediaUrl?: string | null;
  savedMediaId?: string | null;
  randomMediaCategory?: ImageBotCategory | null;
  mediaBatchSize?: number | null;
  sourceChatId?: number | null;
  sourceMessageId?: number | null;
  buttons?: ImageBotAutomationPlanButton[];
  intervalMinutes: number;
  isActive: boolean;
};

function parseImageBotAutomationButtons(value: string): ImageBotAutomationPlanButton[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (button): button is ImageBotAutomationPlanButton =>
        Boolean(button) &&
        typeof button.label === "string" &&
        (button.kind === "premium_plans" ||
          button.kind === "premium_plan" ||
          (button.kind === "bot_link" && typeof button.url === "string")),
    );
  } catch {
    return [];
  }
}

function normalizeImageBotGroupAutomation(
  row: ImageBotGroupAutomationSqliteRow,
): ImageBotGroupAutomationRow {
  return {
    ...row,
    buttons: parseImageBotAutomationButtons(row.buttons),
    is_active: Boolean(row.is_active),
    saved_media_is_active:
      row.saved_media_is_active === null ? null : Boolean(row.saved_media_is_active),
  };
}

const groupAutomationSelect = `
  SELECT ga.*,
         media.category AS saved_media_category,
         media.media_type AS saved_media_type,
         media.file_id AS saved_media_file_id,
         media.caption AS saved_media_caption,
         media.is_active AS saved_media_is_active
  FROM group_automations ga
  LEFT JOIN media ON media.id = ga.saved_media_id
`;

export function getImageBotGroupAutomations(groupId: string): ImageBotGroupAutomationRow[] {
  return (
    imageBotSqlite
      .prepare(
        `${groupAutomationSelect}
         WHERE ga.group_id = ?
         ORDER BY ga.created_at DESC`,
      )
      .all(groupId) as ImageBotGroupAutomationSqliteRow[]
  ).map(normalizeImageBotGroupAutomation);
}

export function getImageBotGroupAutomationById(id: string): ImageBotGroupAutomationRow | null {
  const row = imageBotSqlite.prepare(`${groupAutomationSelect} WHERE ga.id = ?`).get(id) as
    | ImageBotGroupAutomationSqliteRow
    | undefined;
  return row ? normalizeImageBotGroupAutomation(row) : null;
}

export function upsertImageBotGroupAutomation(input: ImageBotGroupAutomationInput) {
  const group = imageBotSqlite
    .prepare("SELECT id, is_active FROM groups WHERE id = ?")
    .get(input.groupId) as { id: string; is_active: number } | undefined;
  if (!group) throw new Error("Grupo do UpMidias não encontrado");
  if (input.isActive && !group.is_active) {
    throw new Error("O bot precisa estar ativo no grupo para ativar a automação");
  }

  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();
  const existing = input.id
    ? (imageBotSqlite
        .prepare("SELECT group_id FROM group_automations WHERE id = ?")
        .get(input.id) as { group_id: string } | undefined)
    : undefined;
  if (input.id && (!existing || existing.group_id !== input.groupId)) {
    throw new Error("Automação do grupo não encontrada");
  }

  imageBotSqlite
    .prepare(
      `INSERT INTO group_automations
       (id, group_id, title, message, content_kind, custom_media_url, saved_media_id,
        random_media_category, media_batch_size,
        source_chat_id, source_message_id, buttons, interval_minutes, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         message = excluded.message,
         content_kind = excluded.content_kind,
         custom_media_url = excluded.custom_media_url,
         saved_media_id = excluded.saved_media_id,
         random_media_category = excluded.random_media_category,
         media_batch_size = excluded.media_batch_size,
         source_chat_id = excluded.source_chat_id,
         source_message_id = excluded.source_message_id,
         buttons = excluded.buttons,
         interval_minutes = excluded.interval_minutes,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.groupId,
      input.title.trim(),
      input.message.trim(),
      input.contentKind,
      input.customMediaUrl || null,
      input.savedMediaId || null,
      input.randomMediaCategory ?? null,
      Math.min(Math.max(Math.trunc(input.mediaBatchSize ?? 1), 1), 20),
      input.sourceChatId ?? null,
      input.sourceMessageId ?? null,
      JSON.stringify(input.buttons ?? []),
      input.intervalMinutes,
      input.isActive ? 1 : 0,
      now,
      now,
    );

  return getImageBotGroupAutomationById(id);
}

export function deleteImageBotGroupAutomation(id: string, groupId: string) {
  return imageBotSqlite
    .prepare("DELETE FROM group_automations WHERE id = ? AND group_id = ?")
    .run(id, groupId).changes;
}

export function markImageBotGroupAutomationSent(id: string, sentAt = new Date().toISOString()) {
  imageBotSqlite
    .prepare(
      `UPDATE group_automations
       SET last_sent_at = ?, locked_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(sentAt, sentAt, id);
}

export function unlockImageBotGroupAutomation(id: string) {
  imageBotSqlite
    .prepare("UPDATE group_automations SET locked_at = NULL, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function claimDueImageBotGroupAutomations(limit = 25): ImageBotGroupAutomationRow[] {
  const now = new Date().toISOString();
  const rows = imageBotSqlite
    .prepare(
      `${groupAutomationSelect}
       JOIN groups ON groups.id = ga.group_id
       WHERE ga.is_active = 1
         AND ga.locked_at IS NULL
         AND groups.is_active = 1
         AND (
           ga.last_sent_at IS NULL
           OR datetime(ga.last_sent_at, '+' || ga.interval_minutes || ' minutes') <= datetime(?)
         )
       ORDER BY COALESCE(ga.last_sent_at, ga.created_at) ASC
       LIMIT ?`,
    )
    .all(now, limit) as ImageBotGroupAutomationSqliteRow[];

  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  imageBotSqlite
    .prepare(
      `UPDATE group_automations SET locked_at = ?, updated_at = ? WHERE id IN (${placeholders})`,
    )
    .run(now, now, ...ids);
  return ids
    .map((id) => getImageBotGroupAutomationById(id))
    .filter(Boolean) as ImageBotGroupAutomationRow[];
}

export function migrateImageBotGroupChatId(oldChatId: number, newChatId: number) {
  const migrate = imageBotSqlite.transaction(() => {
    const oldGroup = imageBotSqlite
      .prepare("SELECT id FROM groups WHERE telegram_chat_id = ?")
      .get(oldChatId) as { id: string } | undefined;
    if (!oldGroup) return false;

    const newGroup = imageBotSqlite
      .prepare("SELECT id FROM groups WHERE telegram_chat_id = ?")
      .get(newChatId) as { id: string } | undefined;
    if (newGroup) {
      imageBotSqlite
        .prepare("UPDATE media SET group_id = ?, telegram_chat_id = ? WHERE group_id = ?")
        .run(newGroup.id, newChatId, oldGroup.id);
      imageBotSqlite.prepare("DELETE FROM groups WHERE id = ?").run(oldGroup.id);
    } else {
      imageBotSqlite
        .prepare(
          `UPDATE groups
           SET telegram_chat_id = ?, type = 'supergroup', updated_at = ?
           WHERE id = ?`,
        )
        .run(newChatId, new Date().toISOString(), oldGroup.id);
      imageBotSqlite
        .prepare("UPDATE media SET telegram_chat_id = ? WHERE group_id = ?")
        .run(newChatId, oldGroup.id);
    }
    return true;
  });

  return migrate();
}

export function saveImageBotMedia(input: {
  telegramChatId: number;
  telegramMessageId: number;
  category: ImageBotCategory;
  mediaType: ImageBotMediaType;
  fileId: string;
  fileUniqueId: string;
  mediaGroupId?: string | null;
  caption?: string | null;
}) {
  const group = imageBotSqlite
    .prepare("SELECT id FROM groups WHERE telegram_chat_id = ?")
    .get(input.telegramChatId) as { id: string } | undefined;
  if (!group) throw new Error("Grupo do UpMidias não encontrado");

  const result = imageBotSqlite
    .prepare(
      `INSERT OR IGNORE INTO media
       (id, group_id, telegram_chat_id, telegram_message_id, category, media_type,
        file_id, file_unique_id, media_group_id, caption, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      group.id,
      input.telegramChatId,
      input.telegramMessageId,
      input.category,
      input.mediaType,
      input.fileId,
      input.fileUniqueId,
      input.mediaGroupId ?? null,
      input.caption ?? null,
      new Date().toISOString(),
    );
  return { saved: result.changes > 0 };
}

export type ImageBotDeliveryType = ImageBotMediaType | "random" | "favorite";

export type ImageBotMediaRow = {
  id: string;
  category: ImageBotCategory;
  media_type: ImageBotMediaType;
  file_id: string;
  file_unique_id: string;
  caption: string | null;
  is_active: boolean;
  delivery_count: number;
};

export function claimImageBotGroupAutomationMedia(input: {
  automationId: string;
  category: ImageBotCategory;
  count: number;
}): ImageBotMediaRow[] {
  const rawBatchSize = Number.isFinite(input.count) ? Math.trunc(input.count) : 1;
  const batchSize = Math.min(Math.max(rawBatchSize, 1), 20);
  const claim = imageBotSqlite.transaction(() => {
    const rows = imageBotSqlite
      .prepare(
        `SELECT id, category, media_type, file_id, file_unique_id, caption,
                is_active, delivery_count
         FROM media
         WHERE category = ?
           AND is_active = 1
           AND deleted_at IS NULL
         ORDER BY RANDOM()
         LIMIT ?`,
      )
      .all(input.category, batchSize) as (Omit<ImageBotMediaRow, "is_active"> & {
      is_active: number;
    })[];
    if (!rows.length) return [];

    const now = new Date().toISOString();
    const saveHistory = imageBotSqlite.prepare(
      `INSERT OR REPLACE INTO group_automation_media_history (automation_id, media_id, sent_at)
       VALUES (?, ?, ?)`,
    );
    const incrementDelivery = imageBotSqlite.prepare(
      "UPDATE media SET delivery_count = delivery_count + 1 WHERE id = ?",
    );
    for (const row of rows) {
      saveHistory.run(input.automationId, row.id, now);
      incrementDelivery.run(row.id);
    }

    return rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
  });

  return claim();
}

const USER_COOLDOWN_MS = 3_000;
const USER_WINDOW_MS = 60_000;
const USER_WINDOW_LIMIT = 12;

export function allowImageBotInteraction(input: {
  telegramUserId: number;
  action: string;
  cooldownMs: number;
  nowMs?: number;
}) {
  if (isImageBotUserAdmin(input.telegramUserId)) return true;

  const now = input.nowMs ?? Date.now();
  const current = imageBotSqlite
    .prepare(
      "SELECT last_action_at FROM interaction_limits WHERE telegram_user_id = ? AND action = ?",
    )
    .get(input.telegramUserId, input.action) as { last_action_at: number } | undefined;
  if (current && now - current.last_action_at < input.cooldownMs) return false;

  imageBotSqlite
    .prepare(
      `INSERT INTO interaction_limits (telegram_user_id, action, last_action_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_user_id, action) DO UPDATE SET
         last_action_at = excluded.last_action_at`,
    )
    .run(input.telegramUserId, input.action, now);
  return true;
}

export function setImageBotUserCategory(telegramUserId: number, category: ImageBotCategory | null) {
  imageBotSqlite
    .prepare(
      `INSERT INTO user_navigation (telegram_user_id, category, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         category = excluded.category,
         updated_at = excluded.updated_at`,
    )
    .run(telegramUserId, category, Date.now());
}

export function getImageBotUserCategory(telegramUserId: number) {
  const row = imageBotSqlite
    .prepare("SELECT category FROM user_navigation WHERE telegram_user_id = ?")
    .get(telegramUserId) as { category: ImageBotCategory | null } | undefined;
  return row?.category ?? null;
}

export function setImageBotPremiumMessageId(telegramUserId: number, messageId: number | null) {
  imageBotSqlite
    .prepare(
      `INSERT INTO user_navigation
       (telegram_user_id, category, premium_message_id, updated_at)
       VALUES (?, NULL, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         premium_message_id = excluded.premium_message_id,
         updated_at = excluded.updated_at`,
    )
    .run(telegramUserId, messageId, Date.now());
}

export function getImageBotPremiumMessageId(telegramUserId: number) {
  const row = imageBotSqlite
    .prepare("SELECT premium_message_id FROM user_navigation WHERE telegram_user_id = ?")
    .get(telegramUserId) as { premium_message_id: number | null } | undefined;
  return row?.premium_message_id ?? null;
}

export function favoriteLastImageBotMedia(telegramUserId: number, category: ImageBotCategory) {
  const last = imageBotSqlite
    .prepare(
      `SELECT media.id
       FROM delivery_limits
       JOIN media ON media.id = delivery_limits.last_media_id
       WHERE delivery_limits.telegram_user_id = ?
         AND media.category = ?
         AND media.deleted_at IS NULL`,
    )
    .get(telegramUserId, category) as { id: string } | undefined;
  if (!last) return { status: "no_media" as const };

  const result = imageBotSqlite
    .prepare(
      `INSERT OR IGNORE INTO favorites (telegram_user_id, media_id, created_at)
       VALUES (?, ?, ?)`,
    )
    .run(telegramUserId, last.id, new Date().toISOString());
  return { status: result.changes ? ("favorited" as const) : ("already_favorited" as const) };
}

export function favoriteImageBotMedia(telegramUserId: number, mediaId: string) {
  const media = imageBotSqlite
    .prepare("SELECT id FROM media WHERE id = ? AND deleted_at IS NULL")
    .get(mediaId) as { id: string } | undefined;
  if (!media) return { status: "not_found" as const };

  const result = imageBotSqlite
    .prepare(
      `INSERT OR IGNORE INTO favorites (telegram_user_id, media_id, created_at)
       VALUES (?, ?, ?)`,
    )
    .run(telegramUserId, media.id, new Date().toISOString());
  return { status: result.changes ? ("favorited" as const) : ("already_favorited" as const) };
}

export function removeImageBotFavorite(telegramUserId: number, mediaId: string) {
  const result = imageBotSqlite
    .prepare("DELETE FROM favorites WHERE telegram_user_id = ? AND media_id = ?")
    .run(telegramUserId, mediaId);
  return { status: result.changes ? ("removed" as const) : ("not_favorited" as const) };
}

export function getImageBotFavoritePage(input: {
  telegramUserId: number;
  category?: ImageBotCategory;
  currentMediaId?: string;
  direction?: "previous" | "next";
}):
  | { status: "empty" }
  | {
      status: "ok";
      media: ImageBotMediaRow;
      index: number;
      total: number;
    } {
  const current = input.currentMediaId
    ? (imageBotSqlite
        .prepare(
          `SELECT media.category
           FROM favorites
           JOIN media ON media.id = favorites.media_id
           WHERE favorites.telegram_user_id = ?
             AND media.id = ?
             AND media.deleted_at IS NULL`,
        )
        .get(input.telegramUserId, input.currentMediaId) as
        | { category: ImageBotCategory }
        | undefined)
    : undefined;
  if (input.currentMediaId && !current) return { status: "empty" };
  const category = input.category ?? current?.category ?? null;

  const favorites = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id,
              media.file_unique_id, media.caption, media.is_active, media.delivery_count
       FROM favorites
       JOIN media ON media.id = favorites.media_id
       WHERE favorites.telegram_user_id = ?
         AND media.is_active = 1
         AND media.deleted_at IS NULL
         AND (? IS NULL OR media.category = ?)
       ORDER BY favorites.created_at DESC, media.id DESC`,
    )
    .all(input.telegramUserId, category, category) as ImageBotMediaRow[];
  if (!favorites.length) return { status: "empty" };

  const currentIndex = input.currentMediaId
    ? favorites.findIndex((media) => media.id === input.currentMediaId)
    : 0;
  if (input.currentMediaId && currentIndex < 0) return { status: "empty" };

  const offset = input.direction === "previous" ? -1 : input.direction === "next" ? 1 : 0;
  const index = (currentIndex + offset + favorites.length) % favorites.length;
  return {
    status: "ok",
    media: favorites[index],
    index: index + 1,
    total: favorites.length,
  };
}

export function upsertImageBotUser(input: {
  telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
  isBot?: boolean;
  isTelegramPremium?: boolean;
  telegramProfile?: Record<string, unknown> | null;
  started?: boolean;
  activityAt?: string;
}) {
  const now = input.activityAt ?? new Date().toISOString();
  const profileJson = input.telegramProfile ? JSON.stringify(input.telegramProfile) : null;
  const detectedLanguage = detectImageBotLanguage(input.languageCode);
  imageBotSqlite
    .prepare(
      `INSERT INTO users
       (id, telegram_user_id, username, first_name, last_name, language_code, preferred_language,
        first_started_at, last_started_at, last_activity_at, is_bot, is_telegram_premium,
        start_count, telegram_profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         username = COALESCE(excluded.username, users.username),
         first_name = COALESCE(excluded.first_name, users.first_name),
         last_name = COALESCE(excluded.last_name, users.last_name),
         language_code = COALESCE(excluded.language_code, users.language_code),
         preferred_language = COALESCE(users.preferred_language, excluded.preferred_language),
         is_bot = excluded.is_bot,
         is_telegram_premium = excluded.is_telegram_premium,
         telegram_profile_json = COALESCE(excluded.telegram_profile_json, users.telegram_profile_json),
         first_started_at = CASE
           WHEN excluded.first_started_at IS NOT NULL
             THEN COALESCE(users.first_started_at, excluded.first_started_at)
           ELSE users.first_started_at
         END,
         last_started_at = COALESCE(excluded.last_started_at, users.last_started_at),
         start_count = users.start_count + CASE
           WHEN excluded.last_started_at IS NOT NULL THEN 1 ELSE 0
         END,
         last_activity_at = excluded.last_activity_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      randomUUID(),
      input.telegramUserId,
      input.username ?? null,
      input.firstName ?? null,
      input.lastName ?? null,
      input.languageCode ?? null,
      detectedLanguage,
      input.started ? now : null,
      input.started ? now : null,
      now,
      input.isBot ? 1 : 0,
      input.isTelegramPremium ? 1 : 0,
      input.started ? 1 : 0,
      profileJson,
      now,
      now,
    );
}

export function getImageBotUserLanguage(telegramUserId: number): ImageBotLanguage {
  const row = imageBotSqlite
    .prepare("SELECT preferred_language, language_code FROM users WHERE telegram_user_id = ?")
    .get(telegramUserId) as
    | { preferred_language: string | null; language_code: string | null }
    | undefined;
  return detectImageBotLanguage(row?.preferred_language ?? row?.language_code);
}

export function setImageBotUserLanguage(telegramUserId: number, language: ImageBotLanguage) {
  return (
    imageBotSqlite
      .prepare("UPDATE users SET preferred_language = ?, updated_at = ? WHERE telegram_user_id = ?")
      .run(language, new Date().toISOString(), telegramUserId).changes > 0
  );
}

export function setImageBotUserAdmin(telegramUserId: number, isAdmin: boolean) {
  const result = imageBotSqlite
    .prepare("UPDATE users SET is_admin = ?, updated_at = ? WHERE telegram_user_id = ?")
    .run(isAdmin ? 1 : 0, new Date().toISOString(), telegramUserId);
  return result.changes > 0;
}

export function isImageBotUserAdmin(telegramUserId: number) {
  const user = imageBotSqlite
    .prepare("SELECT is_admin FROM users WHERE telegram_user_id = ?")
    .get(telegramUserId) as { is_admin: number } | undefined;
  return Boolean(user?.is_admin);
}

export function isImageBotUserBlocked(telegramUserId: number) {
  const user = imageBotSqlite
    .prepare("SELECT is_blocked FROM users WHERE telegram_user_id = ?")
    .get(telegramUserId) as { is_blocked: number } | undefined;
  return Boolean(user?.is_blocked);
}

export function setImageBotUserBlocked(telegramUserId: number, isBlocked: boolean) {
  return (
    imageBotSqlite
      .prepare("UPDATE users SET is_blocked = ?, updated_at = ? WHERE telegram_user_id = ?")
      .run(isBlocked ? 1 : 0, new Date().toISOString(), telegramUserId).changes > 0
  );
}

export function setImageBotUserDeliveryLimit(telegramUserId: number, limit: number) {
  return (
    imageBotSqlite
      .prepare(
        "UPDATE users SET delivery_limit_per_minute = ?, updated_at = ? WHERE telegram_user_id = ?",
      )
      .run(limit, new Date().toISOString(), telegramUserId).changes > 0
  );
}

export type ImageBotUserRow = {
  id: string;
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  preferred_language: ImageBotLanguage | null;
  first_started_at: string;
  last_started_at: string;
  last_activity_at: string;
  media_delivered_count: number;
  is_admin: boolean;
  is_blocked: boolean;
  is_bot: boolean;
  is_telegram_premium: boolean;
  start_count: number;
  telegram_profile_json: string | null;
  delivery_limit_per_minute: number;
  favorite_count: number;
  history_count: number;
  selected_category: ImageBotCategory | null;
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

export function getImageBotUsers(telegramUserId?: number): ImageBotUserRow[] {
  const nowIso = new Date().toISOString();
  const rows = imageBotSqlite
    .prepare(
      `SELECT users.id, users.telegram_user_id, users.username, users.first_name,
              users.last_name, users.language_code, users.preferred_language,
              users.first_started_at,
              users.last_started_at, users.last_activity_at, users.media_delivered_count,
              users.is_admin, users.is_blocked, users.is_bot, users.is_telegram_premium,
              users.start_count, users.telegram_profile_json, users.delivery_limit_per_minute,
              (SELECT COUNT(*) FROM favorites WHERE favorites.telegram_user_id = users.telegram_user_id) AS favorite_count,
              (SELECT COUNT(*) FROM media_deliveries WHERE media_deliveries.telegram_user_id = users.telegram_user_id) AS history_count,
              (SELECT COUNT(*) FROM premium_access
               WHERE premium_access.telegram_user_id = users.telegram_user_id
                 AND premium_access.starts_at <= ?
                 AND (premium_access.expires_at IS NULL OR premium_access.expires_at > ?)
              ) AS active_premium_access_count,
              (SELECT COUNT(*) FROM paid_access
               WHERE paid_access.telegram_user_id = users.telegram_user_id
                 AND paid_access.expires_at > ?) AS active_category_access_count,
              (SELECT COUNT(*) FROM daily_limit_boosts
               WHERE daily_limit_boosts.telegram_user_id = users.telegram_user_id
                 AND daily_limit_boosts.starts_at <= ?
                 AND (daily_limit_boosts.expires_at IS NULL OR daily_limit_boosts.expires_at > ?)
              ) AS active_limit_boost_count,
              EXISTS(
                SELECT 1 FROM daily_limit_boosts
                WHERE daily_limit_boosts.telegram_user_id = users.telegram_user_id
                  AND daily_limit_boosts.starts_at <= ?
                  AND daily_limit_boosts.expires_at IS NULL
              ) AS has_lifetime_limit_boost,
              EXISTS(
                SELECT 1 FROM premium_access
                WHERE premium_access.telegram_user_id = users.telegram_user_id
                  AND premium_access.starts_at <= ?
                  AND premium_access.expires_at IS NULL
              ) AS has_lifetime_premium_access,
              MAX(
                COALESCE((SELECT MAX(expires_at) FROM premium_access
                          WHERE premium_access.telegram_user_id = users.telegram_user_id
                            AND premium_access.starts_at <= ?
                            AND premium_access.expires_at > ?), ''),
                COALESCE((SELECT MAX(expires_at) FROM paid_access
                          WHERE paid_access.telegram_user_id = users.telegram_user_id
                            AND paid_access.expires_at > ?), ''),
                COALESCE((SELECT MAX(expires_at) FROM daily_limit_boosts
                          WHERE daily_limit_boosts.telegram_user_id = users.telegram_user_id
                            AND daily_limit_boosts.starts_at <= ?
                            AND daily_limit_boosts.expires_at > ?), '')
              ) AS premium_until,
              ((SELECT COUNT(*) FROM payment_orders
                WHERE payment_orders.telegram_user_id = users.telegram_user_id
                  AND payment_orders.status = 'paid') +
               (SELECT COUNT(*) FROM limit_payment_orders
                WHERE limit_payment_orders.telegram_user_id = users.telegram_user_id
                  AND limit_payment_orders.status = 'paid') +
               (SELECT COUNT(*) FROM premium_payment_orders
                WHERE premium_payment_orders.telegram_user_id = users.telegram_user_id
                  AND premium_payment_orders.status = 'paid')) AS payment_count,
              ((SELECT COALESCE(SUM(amount), 0) FROM payment_orders
                WHERE payment_orders.telegram_user_id = users.telegram_user_id
                  AND payment_orders.status = 'paid') +
               (SELECT COALESCE(SUM(amount), 0) FROM limit_payment_orders
                WHERE limit_payment_orders.telegram_user_id = users.telegram_user_id
                  AND limit_payment_orders.status = 'paid') +
               (SELECT COALESCE(SUM(amount), 0) FROM premium_payment_orders
                WHERE premium_payment_orders.telegram_user_id = users.telegram_user_id
                  AND premium_payment_orders.status = 'paid')) AS total_paid,
              user_navigation.category AS selected_category
       FROM users
       LEFT JOIN user_navigation USING (telegram_user_id)
       WHERE users.first_started_at IS NOT NULL
         AND (? IS NULL OR users.telegram_user_id = ?)
       ORDER BY users.last_activity_at DESC`,
    )
    .all(
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
      telegramUserId ?? null,
      telegramUserId ?? null,
    ) as (Omit<
    ImageBotUserRow,
    | "is_admin"
    | "is_blocked"
    | "is_bot"
    | "is_telegram_premium"
    | "has_lifetime_premium_access"
    | "has_lifetime_limit_boost"
    | "is_premium"
  > & {
    is_admin: number;
    is_blocked: number;
    is_bot: number;
    is_telegram_premium: number;
    has_lifetime_premium_access: number;
    has_lifetime_limit_boost: number;
  })[];
  return rows.map((row) => ({
    ...row,
    is_admin: Boolean(row.is_admin),
    is_blocked: Boolean(row.is_blocked),
    is_bot: Boolean(row.is_bot),
    is_telegram_premium: Boolean(row.is_telegram_premium),
    has_lifetime_premium_access: Boolean(row.has_lifetime_premium_access),
    has_lifetime_limit_boost: Boolean(row.has_lifetime_limit_boost),
    premium_until: row.premium_until || null,
    is_premium:
      Number(row.active_premium_access_count) > 0 ||
      Number(row.active_category_access_count) > 0 ||
      Number(row.active_limit_boost_count) > 0,
  }));
}

export type ImageBotUserHistoryRow = {
  id: string;
  media_id: string | null;
  category: ImageBotCategory;
  media_type: ImageBotMediaType;
  delivery_source: ImageBotDeliveryType;
  delivered_at: string;
};

export type ImageBotUserFavoriteRow = ImageBotMediaRow & { favorited_at: string };

export function getImageBotUserDetails(telegramUserId: number) {
  const user = getImageBotUsers(telegramUserId)[0];
  if (!user) return null;
  const history = imageBotSqlite
    .prepare(
      `SELECT id, media_id, category, media_type, delivery_source, delivered_at
       FROM media_deliveries
       WHERE telegram_user_id = ?
       ORDER BY delivered_at DESC
       LIMIT 200`,
    )
    .all(telegramUserId) as ImageBotUserHistoryRow[];
  const favorites = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id,
              media.file_unique_id, media.caption, media.is_active, media.delivery_count,
              favorites.created_at AS favorited_at
       FROM favorites
       JOIN media ON media.id = favorites.media_id
       WHERE favorites.telegram_user_id = ?
         AND media.deleted_at IS NULL
       ORDER BY favorites.created_at DESC`,
    )
    .all(telegramUserId) as ImageBotUserFavoriteRow[];
  const activity = imageBotSqlite
    .prepare(
      `SELECT * FROM (
         SELECT 'delivery:' || media_deliveries.id AS id,
                'media_delivered' AS action,
                media_deliveries.delivered_at AS occurred_at,
                media_deliveries.category AS category,
                media_deliveries.media_type AS media_type,
                media_deliveries.media_id AS media_id,
                NULL AS amount,
                NULL AS status,
                media_deliveries.delivery_source AS detail
         FROM media_deliveries
         WHERE media_deliveries.telegram_user_id = ?
         UNION ALL
         SELECT 'favorite:' || favorites.media_id || ':' || favorites.created_at,
                'media_favorited',
                favorites.created_at,
                media.category,
                media.media_type,
                favorites.media_id,
                NULL,
                NULL,
                media.file_id
         FROM favorites
         JOIN media ON media.id = favorites.media_id
         WHERE favorites.telegram_user_id = ?
         UNION ALL
         SELECT 'category-payment:' || payment_orders.id,
                CASE WHEN payment_orders.status = 'paid'
                     THEN 'payment_paid' ELSE 'payment_created' END,
                COALESCE(payment_orders.paid_at, payment_orders.created_at),
                payment_orders.category,
                NULL,
                NULL,
                payment_orders.amount,
                payment_orders.status,
                'category_access'
         FROM payment_orders
         WHERE payment_orders.telegram_user_id = ?
         UNION ALL
         SELECT 'limit-payment:' || limit_payment_orders.id,
                CASE WHEN limit_payment_orders.status = 'paid'
                     THEN 'payment_paid' ELSE 'payment_created' END,
                COALESCE(limit_payment_orders.paid_at, limit_payment_orders.created_at),
                NULL,
                NULL,
                NULL,
                limit_payment_orders.amount,
                limit_payment_orders.status,
                'limit_upgrade'
         FROM limit_payment_orders
         WHERE limit_payment_orders.telegram_user_id = ?
         UNION ALL
         SELECT 'premium-payment:' || premium_payment_orders.id,
                CASE WHEN premium_payment_orders.status = 'paid'
                     THEN 'payment_paid' ELSE 'payment_created' END,
                COALESCE(premium_payment_orders.paid_at, premium_payment_orders.created_at),
                NULL,
                NULL,
                NULL,
                premium_payment_orders.amount,
                premium_payment_orders.status,
                'premium_plan:' || premium_payment_orders.plan_name
         FROM premium_payment_orders
         WHERE premium_payment_orders.telegram_user_id = ?
         UNION ALL
         SELECT 'first-start:' || users.id,
                'first_start',
                users.first_started_at,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL,
                NULL
         FROM users
         WHERE users.telegram_user_id = ? AND users.first_started_at IS NOT NULL
       )
       ORDER BY occurred_at DESC
       LIMIT 300`,
    )
    .all(
      telegramUserId,
      telegramUserId,
      telegramUserId,
      telegramUserId,
      telegramUserId,
      telegramUserId,
    ) as Array<{
    id: string;
    action:
      | "media_delivered"
      | "media_favorited"
      | "payment_created"
      | "payment_paid"
      | "first_start";
    occurred_at: string;
    category: ImageBotCategory | null;
    media_type: ImageBotMediaType | null;
    media_id: string | null;
    amount: number | null;
    status: string | null;
    detail: string | null;
  }>;
  return { user, history, favorites, activity };
}

export type ImageBotPaymentHistoryRow = {
  id: string;
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  product_type: "category_access" | "limit_upgrade" | "premium_plan";
  plan_name: string | null;
  category: ImageBotCategory | null;
  amount: number;
  status: "pending" | "paid" | "canceled" | "expired";
  provider: string;
  provider_payment_id: string | null;
  raw_status: string | null;
  paid_at: string | null;
  pix_expires_at: string | null;
  benefit_expires_at: string | null;
  bonus_count: number | null;
  access_type: "days" | "lifetime" | null;
  access_days: number | null;
  created_at: string;
};

export function getImageBotPaymentHistory(): ImageBotPaymentHistoryRow[] {
  return imageBotSqlite
    .prepare(
      `SELECT orders.*, users.username, users.first_name, users.last_name
       FROM (
         SELECT payment_orders.id, payment_orders.telegram_user_id,
                'category_access' AS product_type, NULL AS plan_name, payment_orders.category,
                payment_orders.amount, payment_orders.status, payment_orders.provider,
                payment_orders.provider_payment_id, payment_orders.raw_status,
                payment_orders.paid_at, payment_orders.expires_at AS pix_expires_at,
                paid_access.expires_at AS benefit_expires_at,
                NULL AS bonus_count, NULL AS access_type, NULL AS access_days,
                payment_orders.created_at
         FROM payment_orders
         LEFT JOIN paid_access ON paid_access.order_id = payment_orders.id
         UNION ALL
         SELECT limit_payment_orders.id, limit_payment_orders.telegram_user_id,
                'limit_upgrade', NULL, NULL, limit_payment_orders.amount,
                limit_payment_orders.status, limit_payment_orders.provider,
                limit_payment_orders.provider_payment_id, limit_payment_orders.raw_status,
                limit_payment_orders.paid_at, limit_payment_orders.expires_at,
                daily_limit_boosts.expires_at,
                limit_payment_orders.bonus_count, limit_payment_orders.access_type,
                limit_payment_orders.access_days, limit_payment_orders.created_at
         FROM limit_payment_orders
         LEFT JOIN daily_limit_boosts ON daily_limit_boosts.order_id = limit_payment_orders.id
         UNION ALL
         SELECT premium_payment_orders.id, premium_payment_orders.telegram_user_id,
                'premium_plan', premium_payment_orders.plan_name, NULL,
                premium_payment_orders.amount, premium_payment_orders.status,
                premium_payment_orders.provider, premium_payment_orders.provider_payment_id,
                premium_payment_orders.raw_status, premium_payment_orders.paid_at,
                premium_payment_orders.expires_at,
                premium_access.expires_at, NULL, premium_payment_orders.access_type,
                premium_payment_orders.access_days, premium_payment_orders.created_at
         FROM premium_payment_orders
         LEFT JOIN premium_access ON premium_access.order_id = premium_payment_orders.id
       ) AS orders
       LEFT JOIN users ON users.telegram_user_id = orders.telegram_user_id
       ORDER BY orders.created_at DESC
       LIMIT 2000`,
    )
    .all() as ImageBotPaymentHistoryRow[];
}

export function recordImageBotMediaDelivery(input: {
  telegramUserId: number;
  media: ImageBotMediaRow;
  source: ImageBotDeliveryType;
  deliveredAt?: string;
}) {
  const deliveredAt = input.deliveredAt ?? new Date().toISOString();
  imageBotSqlite
    .prepare(
      `INSERT OR IGNORE INTO users
       (id, telegram_user_id, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), input.telegramUserId, deliveredAt, deliveredAt, deliveredAt);
  imageBotSqlite
    .prepare(
      `INSERT INTO media_deliveries
       (id, telegram_user_id, media_id, category, media_type, delivery_source, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.telegramUserId,
      input.media.id,
      input.media.category,
      input.media.media_type,
      input.source,
      deliveredAt,
    );
  imageBotSqlite
    .prepare("UPDATE media SET delivery_count = delivery_count + 1 WHERE id = ?")
    .run(input.media.id);
  imageBotSqlite
    .prepare(
      `UPDATE users
       SET media_delivered_count = media_delivered_count + 1,
           last_activity_at = ?, updated_at = ?
       WHERE telegram_user_id = ?`,
    )
    .run(deliveredAt, deliveredAt, input.telegramUserId);
}

function imageBotDailyLimitDayKey(date: Date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  return dayStart.toISOString().slice(0, 10);
}

function getImageBotDailyLimitBonus(telegramUserId: number, dayKey: string, nowIso: string) {
  const boost = imageBotSqlite
    .prepare(
      `SELECT COALESCE(SUM(bonus_count), 0) AS total
       FROM daily_limit_boosts
       WHERE telegram_user_id = ?
         AND (
           (starts_at IS NOT NULL AND starts_at <= ? AND (expires_at IS NULL OR expires_at > ?))
           OR (starts_at IS NULL AND valid_on = ?)
         )`,
    )
    .get(telegramUserId, nowIso, nowIso, dayKey) as { total: number } | undefined;
  return Math.max(0, Number(boost?.total ?? 0));
}

export function grantImageBotDailyLimitBoost(input: {
  telegramUserId: number;
  orderId: string;
  bonusCount: number;
  accessType: "days" | "lifetime";
  accessDays: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const bonusCount = Math.max(1, Math.trunc(input.bonusCount));
  const expiresAt =
    input.accessType === "lifetime"
      ? null
      : new Date(
          now.getTime() + Math.max(1, Math.trunc(input.accessDays)) * 86_400_000,
        ).toISOString();
  imageBotSqlite
    .prepare(
      `INSERT OR IGNORE INTO daily_limit_boosts
       (id, telegram_user_id, order_id, bonus_count, valid_on, starts_at, expires_at,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.telegramUserId,
      input.orderId,
      bonusCount,
      imageBotDailyLimitDayKey(now),
      nowIso,
      expiresAt,
      nowIso,
      nowIso,
    );
  return { bonusCount, expiresAt };
}

export function claimImageBotMedia(input: {
  telegramUserId: number;
  category: ImageBotCategory;
  deliveryType: ImageBotDeliveryType;
  nowMs?: number;
}):
  | { status: "ok"; media: ImageBotMediaRow; deliveredCount: number }
  | { status: "blocked" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "daily_limited"; retryAfterSeconds: number }
  | { status: "empty" } {
  const claim = imageBotSqlite.transaction(() => {
    const now = input.nowMs ?? Date.now();
    const settings = getImageBotSettings();
    const userControl = imageBotSqlite
      .prepare("SELECT is_blocked, is_admin FROM users WHERE telegram_user_id = ?")
      .get(input.telegramUserId) as { is_blocked: number; is_admin: number } | undefined;
    if (userControl?.is_blocked) return { status: "blocked" as const };
    const isAdmin = Boolean(userControl?.is_admin);
    const premiumFeatures = isAdmin ? null : getImageBotPremiumFeatures(input.telegramUserId);
    const cooldownSeconds =
      premiumFeatures?.active && premiumFeatures.media_cooldown_seconds !== null
        ? premiumFeatures.media_cooldown_seconds
        : settings.flood_cooldown_seconds;
    const cooldownMs = Math.max(0, cooldownSeconds * 1000);
    const globalWindowLimit = Math.max(1, settings.flood_limit_per_minute || USER_WINDOW_LIMIT);
    const userWindowLimit = globalWindowLimit;
    const limit = imageBotSqlite
      .prepare("SELECT * FROM delivery_limits WHERE telegram_user_id = ?")
      .get(input.telegramUserId) as
      | {
          last_request_at: number;
          window_started_at: number;
          request_count: number;
          last_media_id: string | null;
        }
      | undefined;

    if (!isAdmin && limit && now - limit.last_request_at < cooldownMs) {
      return {
        status: "rate_limited" as const,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((cooldownMs - (now - limit.last_request_at)) / 1000),
        ),
      };
    }

    const sameWindow = Boolean(limit && now - limit.window_started_at < USER_WINDOW_MS);
    const requestCount = sameWindow ? limit!.request_count : 0;
    if (!isAdmin && sameWindow && requestCount >= userWindowLimit) {
      return {
        status: "rate_limited" as const,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((USER_WINDOW_MS - (now - limit!.window_started_at)) / 1000),
        ),
      };
    }

    const planDailyLimit =
      premiumFeatures?.active && premiumFeatures.daily_media_limit
        ? premiumFeatures.daily_media_limit
        : 0;
    const baseDailyLimit = planDailyLimit > 0 ? planDailyLimit : settings.daily_media_limit;
    if (!isAdmin && baseDailyLimit > 0) {
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const dailyBonus = getImageBotDailyLimitBonus(
        input.telegramUserId,
        dayStart.toISOString().slice(0, 10),
        new Date(now).toISOString(),
      );
      const dailyAllowed = baseDailyLimit + dailyBonus;
      const daily = imageBotSqlite
        .prepare(
          `SELECT COUNT(*) AS total
           FROM media_deliveries
           WHERE telegram_user_id = ? AND delivered_at >= ?`,
        )
        .get(input.telegramUserId, dayStart.toISOString()) as { total: number };
      if (daily.total >= dailyAllowed) {
        return {
          status: "daily_limited" as const,
          retryAfterSeconds: Math.max(1, Math.ceil((dayEnd.getTime() - now) / 1000)),
        };
      }
    }

    const favoritesOnly = input.deliveryType === "favorite";
    const selectMedia = (excludeLast: boolean) =>
      imageBotSqlite
        .prepare(
          `SELECT id, category, media_type, file_id, file_unique_id, caption,
                  is_active, delivery_count
           FROM media
           WHERE category = ?
             AND is_active = 1
             AND deleted_at IS NULL
             AND (? = 0 OR EXISTS (
               SELECT 1 FROM favorites
               WHERE favorites.telegram_user_id = ? AND favorites.media_id = media.id
             ))
             AND (? = 0 OR id != ?)
           ORDER BY RANDOM()
           LIMIT 1`,
        )
        .get(
          input.category,
          favoritesOnly ? 1 : 0,
          input.telegramUserId,
          excludeLast && limit?.last_media_id ? 1 : 0,
          limit?.last_media_id ?? "",
        ) as ImageBotMediaRow | undefined;

    const media = selectMedia(true) ?? selectMedia(false);
    if (!media) return { status: "empty" as const };

    imageBotSqlite
      .prepare(
        `INSERT INTO delivery_limits
         (telegram_user_id, last_request_at, window_started_at, request_count, last_media_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET
           last_request_at = excluded.last_request_at,
           window_started_at = excluded.window_started_at,
           request_count = excluded.request_count,
           last_media_id = excluded.last_media_id`,
      )
      .run(
        input.telegramUserId,
        now,
        sameWindow ? limit!.window_started_at : now,
        requestCount + 1,
        media.id,
      );

    recordImageBotMediaDelivery({
      telegramUserId: input.telegramUserId,
      media,
      source: input.deliveryType,
      deliveredAt: new Date(now).toISOString(),
    });
    const user = imageBotSqlite
      .prepare("SELECT media_delivered_count FROM users WHERE telegram_user_id = ?")
      .get(input.telegramUserId) as { media_delivered_count: number } | undefined;

    return { status: "ok" as const, media, deliveredCount: user?.media_delivered_count ?? 0 };
  });

  return claim();
}

export type ImageBotAdminMediaRow = ImageBotMediaRow & {
  telegram_message_id: number;
  telegram_chat_id: number;
  media_group_id: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  restored_at: string | null;
  restored_by: string | null;
  favorite_count: number;
  is_active: boolean;
  delivery_count: number;
};

export function getImageBotMedia(): ImageBotAdminMediaRow[] {
  const rows = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id,
              media.file_unique_id, media.caption, media.telegram_message_id,
              media.telegram_chat_id, media.media_group_id, media.created_at,
              media.deleted_at, media.deleted_by, media.restored_at, media.restored_by,
              media.is_active, media.delivery_count,
              COUNT(favorites.media_id) AS favorite_count
       FROM media
       LEFT JOIN favorites ON favorites.media_id = media.id
       WHERE media.deleted_at IS NULL
       GROUP BY media.id
       ORDER BY media.created_at DESC
       LIMIT 1000`,
    )
    .all() as (Omit<ImageBotAdminMediaRow, "is_active"> & { is_active: number })[];
  return rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
}

export type ImageBotMediaSummary = {
  total: number;
  active: number;
  inactive: number;
  photos: number;
  videos: number;
  hetero: number;
  trans: number;
  favorites: number;
  deliveries: number;
};

export function getImageBotMediaSummary(): ImageBotMediaSummary {
  return imageBotSqlite
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN media.is_active = 1 THEN 1 ELSE 0 END), 0) AS active,
              COALESCE(SUM(CASE WHEN media.is_active = 0 THEN 1 ELSE 0 END), 0) AS inactive,
              COALESCE(SUM(CASE WHEN media.media_type = 'photo' THEN 1 ELSE 0 END), 0) AS photos,
              COALESCE(SUM(CASE WHEN media.media_type = 'video' THEN 1 ELSE 0 END), 0) AS videos,
              COALESCE(SUM(CASE WHEN media.category = 'hetero' THEN 1 ELSE 0 END), 0) AS hetero,
              COALESCE(SUM(CASE WHEN media.category = 'trans' THEN 1 ELSE 0 END), 0) AS trans,
              COALESCE((SELECT COUNT(*) FROM favorites), 0) AS favorites,
              COALESCE(SUM(media.delivery_count), 0) AS deliveries
       FROM media
       WHERE media.deleted_at IS NULL`,
    )
    .get() as ImageBotMediaSummary;
}

function getRankedImageBotMedia(orderBy: string, limit: number) {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const rows = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id,
              media.file_unique_id, media.caption, media.telegram_message_id,
              media.telegram_chat_id, media.media_group_id, media.created_at,
              media.deleted_at, media.deleted_by, media.restored_at, media.restored_by,
              media.is_active, media.delivery_count,
              COUNT(favorites.media_id) AS favorite_count
       FROM media
       LEFT JOIN favorites ON favorites.media_id = media.id
       WHERE media.deleted_at IS NULL
       GROUP BY media.id
       ORDER BY ${orderBy}
       LIMIT ?`,
    )
    .all(safeLimit) as (Omit<ImageBotAdminMediaRow, "is_active"> & { is_active: number })[];
  return rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
}

export function getRecentImageBotMedia(limit = 8) {
  return getRankedImageBotMedia("media.created_at DESC", limit);
}

export function getTopImageBotMedia(limit = 8) {
  return getRankedImageBotMedia(
    "favorite_count DESC, media.delivery_count DESC, media.created_at DESC",
    limit,
  );
}

export function getImageBotMediaById(id: string): ImageBotAdminMediaRow | null {
  const row = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id,
              media.file_unique_id, media.caption, media.telegram_message_id,
              media.telegram_chat_id, media.media_group_id, media.created_at,
              media.deleted_at, media.deleted_by, media.restored_at, media.restored_by,
              media.is_active, media.delivery_count,
              COUNT(favorites.media_id) AS favorite_count
       FROM media
       LEFT JOIN favorites ON favorites.media_id = media.id
       WHERE media.id = ?
       GROUP BY media.id`,
    )
    .get(id) as (Omit<ImageBotAdminMediaRow, "is_active"> & { is_active: number }) | undefined;
  return row ? { ...row, is_active: Boolean(row.is_active) } : null;
}

export function getLatestActiveImageBotMedia(): ImageBotAdminMediaRow | null {
  const row = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id,
              media.file_unique_id, media.caption, media.telegram_message_id,
              media.telegram_chat_id, media.media_group_id, media.created_at,
              media.deleted_at, media.deleted_by, media.restored_at, media.restored_by,
              media.is_active, media.delivery_count,
              COUNT(favorites.media_id) AS favorite_count
       FROM media
       LEFT JOIN favorites ON favorites.media_id = media.id
       WHERE media.deleted_at IS NULL AND media.is_active = 1
       GROUP BY media.id
       ORDER BY media.created_at DESC
       LIMIT 1`,
    )
    .get() as (Omit<ImageBotAdminMediaRow, "is_active"> & { is_active: number }) | undefined;
  return row ? { ...row, is_active: Boolean(row.is_active) } : null;
}

export function getRandomActiveImageBotMedia(
  category: ImageBotCategory,
): ImageBotAdminMediaRow | null {
  const row = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id,
              media.file_unique_id, media.caption, media.telegram_message_id,
              media.telegram_chat_id, media.media_group_id, media.created_at,
              media.deleted_at, media.deleted_by, media.restored_at, media.restored_by,
              media.is_active, media.delivery_count,
              COUNT(favorites.media_id) AS favorite_count
       FROM media
       LEFT JOIN favorites ON favorites.media_id = media.id
       WHERE media.deleted_at IS NULL
         AND media.is_active = 1
         AND media.category = ?
       GROUP BY media.id
       ORDER BY RANDOM()
       LIMIT 1`,
    )
    .get(category) as
    | (Omit<ImageBotAdminMediaRow, "is_active"> & { is_active: number })
    | undefined;
  return row ? { ...row, is_active: Boolean(row.is_active) } : null;
}

export function setImageBotMediaActive(ids: string[], isActive: boolean) {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  return imageBotSqlite
    .prepare(`UPDATE media SET is_active = ? WHERE deleted_at IS NULL AND id IN (${placeholders})`)
    .run(isActive ? 1 : 0, ...ids).changes;
}

export function getImageBotDeletedMedia(): ImageBotAdminMediaRow[] {
  const rows = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id,
              media.file_unique_id, media.caption, media.telegram_message_id,
              media.telegram_chat_id, media.media_group_id, media.created_at,
              media.deleted_at, media.deleted_by, media.restored_at, media.restored_by,
              media.is_active, media.delivery_count,
              COUNT(favorites.media_id) AS favorite_count
       FROM media
       LEFT JOIN favorites ON favorites.media_id = media.id
       WHERE media.deleted_at IS NOT NULL
       GROUP BY media.id
       ORDER BY media.deleted_at DESC
       LIMIT 1000`,
    )
    .all() as (Omit<ImageBotAdminMediaRow, "is_active"> & { is_active: number })[];
  return rows.map((row) => ({ ...row, is_active: Boolean(row.is_active) }));
}

export function deleteImageBotMediaMany(ids: string[], deletedBy = "panel") {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const result = imageBotSqlite
    .prepare(
      `UPDATE media
       SET is_active = 0, deleted_at = ?, deleted_by = ?
       WHERE deleted_at IS NULL AND id IN (${placeholders})`,
    )
    .run(now, deletedBy, ...ids);
  if (result.changes) {
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: deletedBy,
      action: "media.delete_many",
      entityType: "media",
      entityId: ids.join(","),
      details: { count: result.changes },
    });
  }
  return result.changes;
}

export function deleteImageBotMedia(id: string, deletedBy = "panel") {
  const result = imageBotSqlite
    .prepare(
      `UPDATE media
       SET is_active = 0, deleted_at = ?, deleted_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(new Date().toISOString(), deletedBy, id);
  if (result.changes) {
    recordImageBotAuditLog({
      actorType: deletedBy.startsWith("telegram:") ? "telegram" : "panel",
      actorId: deletedBy,
      action: "media.delete",
      entityType: "media",
      entityId: id,
    });
  }
  return result.changes > 0;
}

export function restoreImageBotMedia(id: string, restoredBy = "panel") {
  const now = new Date().toISOString();
  const result = imageBotSqlite
    .prepare(
      `UPDATE media
       SET is_active = 1, deleted_at = NULL, deleted_by = NULL, restored_at = ?, restored_by = ?
       WHERE id = ? AND deleted_at IS NOT NULL`,
    )
    .run(now, restoredBy, id);
  if (result.changes) {
    recordImageBotAuditLog({
      actorType: restoredBy.startsWith("telegram:") ? "telegram" : "panel",
      actorId: restoredBy,
      action: "media.restore",
      entityType: "media",
      entityId: id,
    });
  }
  return result.changes > 0;
}

export function getImageBotDashboardStats() {
  const rows = imageBotSqlite
    .prepare(
      `SELECT category, media_type, COUNT(*) AS total
       FROM media
       WHERE deleted_at IS NULL
       GROUP BY category, media_type`,
    )
    .all() as { category: ImageBotCategory; media_type: ImageBotMediaType; total: number }[];
  const value = (category?: ImageBotCategory, mediaType?: ImageBotMediaType) =>
    rows
      .filter(
        (row) =>
          (!category || row.category === category) && (!mediaType || row.media_type === mediaType),
      )
      .reduce((sum, row) => sum + Number(row.total), 0);

  return {
    total: value(),
    photos: value(undefined, "photo"),
    videos: value(undefined, "video"),
    hetero: {
      total: value("hetero"),
      photos: value("hetero", "photo"),
      videos: value("hetero", "video"),
    },
    trans: {
      total: value("trans"),
      photos: value("trans", "photo"),
      videos: value("trans", "video"),
    },
  };
}

export function getImageBotDatabasePath() {
  imageBotSqlite.pragma("wal_checkpoint(FULL)");
  return databasePath;
}

export type ImageBotAdminRole = "owner" | "manager" | "moderator" | "viewer";

export type ImageBotAdminPermissionRow = {
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  role: ImageBotAdminRole;
  can_delete_media: boolean;
  can_restore_media: boolean;
  can_manage_users: boolean;
  can_manage_settings: boolean;
  can_view_stats: boolean;
  created_at: string;
  updated_at: string;
};

type ImageBotAdminPermissionSqliteRow = Omit<
  ImageBotAdminPermissionRow,
  | "can_delete_media"
  | "can_restore_media"
  | "can_manage_users"
  | "can_manage_settings"
  | "can_view_stats"
> & {
  can_delete_media: number;
  can_restore_media: number;
  can_manage_users: number;
  can_manage_settings: number;
  can_view_stats: number;
};

function normalizePermission(row: ImageBotAdminPermissionSqliteRow): ImageBotAdminPermissionRow {
  return {
    ...row,
    can_delete_media: Boolean(row.can_delete_media),
    can_restore_media: Boolean(row.can_restore_media),
    can_manage_users: Boolean(row.can_manage_users),
    can_manage_settings: Boolean(row.can_manage_settings),
    can_view_stats: Boolean(row.can_view_stats),
  };
}

export function getImageBotAdminPermissions(): ImageBotAdminPermissionRow[] {
  const rows = imageBotSqlite
    .prepare(
      `SELECT users.telegram_user_id, users.username, users.first_name, users.last_name,
              COALESCE(admin_permissions.role, 'owner') AS role,
              COALESCE(admin_permissions.can_delete_media, 1) AS can_delete_media,
              COALESCE(admin_permissions.can_restore_media, 1) AS can_restore_media,
              COALESCE(admin_permissions.can_manage_users, 1) AS can_manage_users,
              COALESCE(admin_permissions.can_manage_settings, 1) AS can_manage_settings,
              COALESCE(admin_permissions.can_view_stats, 1) AS can_view_stats,
              COALESCE(admin_permissions.created_at, users.created_at) AS created_at,
              COALESCE(admin_permissions.updated_at, users.updated_at) AS updated_at
       FROM users
       LEFT JOIN admin_permissions USING (telegram_user_id)
       WHERE users.is_admin = 1
       ORDER BY role, users.first_name, users.telegram_user_id`,
    )
    .all() as ImageBotAdminPermissionSqliteRow[];
  return rows.map(normalizePermission);
}

export function getImageBotAdminPermission(
  telegramUserId: number,
): ImageBotAdminPermissionRow | null {
  const row = imageBotSqlite
    .prepare(
      `SELECT users.telegram_user_id, users.username, users.first_name, users.last_name,
              COALESCE(admin_permissions.role, 'owner') AS role,
              COALESCE(admin_permissions.can_delete_media, 1) AS can_delete_media,
              COALESCE(admin_permissions.can_restore_media, 1) AS can_restore_media,
              COALESCE(admin_permissions.can_manage_users, 1) AS can_manage_users,
              COALESCE(admin_permissions.can_manage_settings, 1) AS can_manage_settings,
              COALESCE(admin_permissions.can_view_stats, 1) AS can_view_stats,
              COALESCE(admin_permissions.created_at, users.created_at) AS created_at,
              COALESCE(admin_permissions.updated_at, users.updated_at) AS updated_at
       FROM users
       LEFT JOIN admin_permissions USING (telegram_user_id)
       WHERE users.telegram_user_id = ? AND users.is_admin = 1`,
    )
    .get(telegramUserId) as ImageBotAdminPermissionSqliteRow | undefined;
  return row ? normalizePermission(row) : null;
}

export function upsertImageBotAdminPermission(input: {
  telegramUserId: number;
  role: ImageBotAdminRole;
  canDeleteMedia: boolean;
  canRestoreMedia: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canViewStats: boolean;
  actor?: string;
}) {
  const now = new Date().toISOString();
  imageBotSqlite
    .prepare(
      `INSERT OR IGNORE INTO users
       (id, telegram_user_id, first_started_at, last_started_at, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), input.telegramUserId, now, now, now, now, now);
  imageBotSqlite
    .prepare("UPDATE users SET is_admin = 1, updated_at = ? WHERE telegram_user_id = ?")
    .run(now, input.telegramUserId);
  const result = imageBotSqlite
    .prepare(
      `INSERT INTO admin_permissions
       (id, telegram_user_id, role, can_delete_media, can_restore_media,
        can_manage_users, can_manage_settings, can_view_stats, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         role = excluded.role,
         can_delete_media = excluded.can_delete_media,
         can_restore_media = excluded.can_restore_media,
         can_manage_users = excluded.can_manage_users,
         can_manage_settings = excluded.can_manage_settings,
         can_view_stats = excluded.can_view_stats,
         updated_at = excluded.updated_at`,
    )
    .run(
      randomUUID(),
      input.telegramUserId,
      input.role,
      input.canDeleteMedia ? 1 : 0,
      input.canRestoreMedia ? 1 : 0,
      input.canManageUsers ? 1 : 0,
      input.canManageSettings ? 1 : 0,
      input.canViewStats ? 1 : 0,
      now,
      now,
    );
  recordImageBotAuditLog({
    actorType: "panel",
    actorId: input.actor ?? "panel",
    action: "admin.permission.upsert",
    entityType: "user",
    entityId: String(input.telegramUserId),
    details: input,
  });
  return result.changes > 0;
}

export function removeImageBotAdminPermission(telegramUserId: number, actor = "panel") {
  const now = new Date().toISOString();
  const result = imageBotSqlite
    .prepare("UPDATE users SET is_admin = 0, updated_at = ? WHERE telegram_user_id = ?")
    .run(now, telegramUserId);
  imageBotSqlite
    .prepare("DELETE FROM admin_permissions WHERE telegram_user_id = ?")
    .run(telegramUserId);
  if (result.changes) {
    recordImageBotAuditLog({
      actorType: "panel",
      actorId: actor,
      action: "admin.permission.remove",
      entityType: "user",
      entityId: String(telegramUserId),
    });
  }
  return result.changes > 0;
}

export type ImageBotAuditLogRow = {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  created_at: string;
};

export function recordImageBotAuditLog(input: {
  actorType: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: unknown;
}) {
  imageBotSqlite
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_type, actor_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.details === undefined ? null : JSON.stringify(input.details),
      new Date().toISOString(),
    );
}

export function getImageBotAuditLogs(limit = 200): ImageBotAuditLogRow[] {
  return imageBotSqlite
    .prepare(
      `SELECT id, actor_type, actor_id, action, entity_type, entity_id, details, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as ImageBotAuditLogRow[];
}

export function recordImageBotTelegramError(input: {
  action: string;
  chatId?: number | string | null;
  telegramUserId?: number | null;
  error: unknown;
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  imageBotSqlite
    .prepare(
      `INSERT INTO telegram_errors
       (id, action, chat_id, telegram_user_id, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.action,
      input.chatId == null ? null : String(input.chatId),
      input.telegramUserId ?? null,
      message.slice(0, 4000),
      new Date().toISOString(),
    );
}

export type ImageBotTelegramErrorRow = {
  id: string;
  action: string;
  chat_id: string | null;
  telegram_user_id: number | null;
  error_message: string;
  created_at: string;
};

export function getImageBotTelegramErrors(limit = 20): ImageBotTelegramErrorRow[] {
  return imageBotSqlite
    .prepare(
      `SELECT id, action, chat_id, telegram_user_id, error_message, created_at
       FROM telegram_errors
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(Math.trunc(limit), 1), 100)) as ImageBotTelegramErrorRow[];
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function iso(date: Date) {
  return date.toISOString();
}

export function getImageBotAdminStats(now = new Date()) {
  const today = startOfDay(now);
  const week = addDays(today, -6);
  const month = addDays(today, -29);
  const deliveryRange = (from: Date) =>
    imageBotSqlite
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN media_type = 'photo' THEN 1 ELSE 0 END) AS photos,
                SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) AS videos,
                COUNT(DISTINCT telegram_user_id) AS users
         FROM media_deliveries
         WHERE delivered_at >= ?`,
      )
      .get(iso(from)) as {
      total: number;
      photos: number | null;
      videos: number | null;
      users: number;
    };

  const deliveredToday = deliveryRange(today);
  const deliveredWeek = deliveryRange(week);
  const deliveredMonth = deliveryRange(month);

  const mediaTypeTotals = imageBotSqlite
    .prepare(
      `SELECT media_type, COUNT(*) AS total
       FROM media
       WHERE deleted_at IS NULL
       GROUP BY media_type`,
    )
    .all() as { media_type: ImageBotMediaType; total: number }[];

  const popularFavorites = imageBotSqlite
    .prepare(
      `SELECT media.id, media.category, media.media_type, media.file_id, media.caption,
              COUNT(favorites.media_id) AS favorite_count
       FROM media
       JOIN favorites ON favorites.media_id = media.id
       WHERE media.deleted_at IS NULL
       GROUP BY media.id
       ORDER BY favorite_count DESC, media.created_at DESC
       LIMIT 10`,
    )
    .all() as {
    id: string;
    category: ImageBotCategory;
    media_type: ImageBotMediaType;
    file_id: string;
    caption: string | null;
    favorite_count: number;
  }[];

  const hourlyUsage = imageBotSqlite
    .prepare(
      `SELECT CAST(strftime('%H', delivered_at) AS INTEGER) AS hour, COUNT(*) AS total
       FROM media_deliveries
       WHERE delivered_at >= ?
       GROUP BY hour
       ORDER BY hour`,
    )
    .all(iso(month)) as { hour: number; total: number }[];

  const growth = imageBotSqlite
    .prepare(
      `WITH RECURSIVE days(day) AS (
         SELECT date(?)
         UNION ALL
         SELECT date(day, '+1 day') FROM days WHERE day < date(?)
       )
       SELECT days.day,
              (SELECT COUNT(*) FROM users WHERE date(first_started_at) = days.day) AS users,
              (SELECT COUNT(*) FROM media WHERE deleted_at IS NULL AND date(created_at) = days.day) AS media,
              (SELECT COUNT(*) FROM media_deliveries WHERE date(delivered_at) = days.day) AS deliveries
       FROM days
       ORDER BY days.day`,
    )
    .all(iso(addDays(today, -13)), iso(today)) as {
    day: string;
    users: number;
    media: number;
    deliveries: number;
  }[];

  const userTotals = imageBotSqlite
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN is_blocked = 1 THEN 1 ELSE 0 END) AS blocked
       FROM users
       WHERE first_started_at IS NOT NULL`,
    )
    .get() as { total: number; blocked: number | null };

  const telegramErrors = imageBotSqlite
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week,
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS month
       FROM telegram_errors`,
    )
    .get(iso(today), iso(week), iso(month)) as {
    today: number | null;
    week: number | null;
    month: number | null;
  };

  return {
    delivered: {
      today: {
        ...deliveredToday,
        photos: deliveredToday.photos ?? 0,
        videos: deliveredToday.videos ?? 0,
      },
      week: {
        ...deliveredWeek,
        photos: deliveredWeek.photos ?? 0,
        videos: deliveredWeek.videos ?? 0,
      },
      month: {
        ...deliveredMonth,
        photos: deliveredMonth.photos ?? 0,
        videos: deliveredMonth.videos ?? 0,
      },
    },
    mediaTypeTotals: {
      photos: mediaTypeTotals.find((item) => item.media_type === "photo")?.total ?? 0,
      videos: mediaTypeTotals.find((item) => item.media_type === "video")?.total ?? 0,
    },
    popularFavorites,
    activeUsers: {
      today: deliveredToday.users,
      week: deliveredWeek.users,
      month: deliveredMonth.users,
    },
    hourlyUsage,
    growth,
    blockRate: {
      totalUsers: userTotals.total,
      blockedUsers: userTotals.blocked ?? 0,
      percent: userTotals.total
        ? Number((((userTotals.blocked ?? 0) / userTotals.total) * 100).toFixed(2))
        : 0,
    },
    telegramErrors: {
      today: telegramErrors.today ?? 0,
      week: telegramErrors.week ?? 0,
      month: telegramErrors.month ?? 0,
      monthRate: deliveredMonth.total
        ? Number((((telegramErrors.month ?? 0) / deliveredMonth.total) * 100).toFixed(2))
        : 0,
    },
  };
}
