import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

import { deriveManagedBotWebhookSecret, getManagedBotToken } from "@/lib/bot-manager.server";
import {
  allowImageBotInteraction,
  claimImageBotTelegramUpdate,
  claimImageBotMedia,
  categoryFromGroupTitle,
  deleteImageBotMedia,
  favoriteImageBotMedia,
  getImageBotAdminPermissions,
  getImageBotAdminPermission,
  getImageBotAdminStats,
  getImageBotAuditLogs,
  getImageBotDeletedMedia,
  getImageBotFavoritePage,
  getImageBotGroupAutomations,
  getImageBotGroups,
  getLatestActiveImageBotMedia,
  getImageBotMediaById,
  getImageBotMediaSummary,
  getImageBotPremiumMessageId,
  getImageBotPremiumPlan,
  getImageBotPremiumPlans,
  getImageBotTelegramErrors,
  getImageBotUserDetails,
  getImageBotUserCategory,
  getImageBotUsers,
  getRandomActiveImageBotMedia,
  getImageBotSettings,
  getRecentImageBotMedia,
  getTopImageBotMedia,
  hasImageBotFavoriteAccess,
  hasLifetimeImageBotPremiumAccess,
  isImageBotUserAdmin,
  isImageBotUserBlocked,
  migrateImageBotGroupChatId,
  removeImageBotAdminPermission,
  recordImageBotTelegramError,
  recordImageBotMediaDelivery,
  removeImageBotFavorite,
  restoreImageBotMedia,
  saveImageBotMedia,
  setImageBotUserBlocked,
  setImageBotUserCategory,
  setImageBotPremiumMessageId,
  updateImageBotSettings,
  upsertImageBotAdminPermission,
  upsertImageBotUser,
  upsertImageBotGroup,
  type ImageBotPremiumPlanRow,
  type ImageBotAdminPermissionRow,
  type ImageBotSettingsRow,
} from "@/lib/image-bot-database.server";
import {
  createImageBotPremiumPixOrder,
  sendImageBotLimitBoostPixQrCode,
  sendImageBotPixQrCode,
  sendImageBotPremiumPixOrder,
  sendImageBotPremiumPixQrCode,
} from "@/lib/image-bot-payments.server";
import {
  answerCallbackQueryWithToken,
  clearReplyKeyboardWithToken,
  deleteMessageWithToken,
  editMessageMediaWithToken,
  editMessageReplyMarkupWithToken,
  editMessageTextWithToken,
  getChatMemberCountWithToken,
  sendMessageWithToken,
  sendMessageWithTokenReplyKeyboard,
  sendPhotoWithToken,
  sendPhotoWithTokenReplyKeyboard,
  sendVideoWithToken,
  sendVideoWithTokenReplyKeyboard,
  type InlineKeyboard,
  type ReplyKeyboard,
} from "@/lib/telegram.server";

const categoryMenu: ReplyKeyboard = {
  keyboard: [[{ text: "Hétero" }, { text: "Trans" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
  is_persistent: true,
  input_field_placeholder: "Escolha uma categoria",
};

const mediaMenu: ReplyKeyboard = {
  keyboard: [[{ text: "🎲 Mídias" }, { text: "❤️ Favoritos" }], [{ text: "⬅️ Voltar" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
  is_persistent: true,
  input_field_placeholder: "Escolha uma opção",
};

const legacyCategoryLabels = {
  hetero: ["Hetero", "Hétero", "HÃ©tero"],
  trans: ["Trans"],
};

const legacyMediaLabels = {
  photo: ["Fotos", "📷 Fotos", "ðŸ“· Fotos"],
  video: ["Videos", "Vídeos", "🎥 Vídeos", "ðŸŽ¥ VÃ­deos"],
  random: ["Aleatorio", "Aleatório", "🎲 Aleatório", "ðŸŽ² AleatÃ³rio"],
  back: ["Voltar", "⬅️ Voltar", "â¬…ï¸ Voltar"],
  favorites: ["Favoritos", "❤️ Favoritos", "â¤ï¸ Favoritos"],
};

const adminLabels = {
  open: "Admin",
  status: "Status",
  media: "Midias",
  users: "Usuarios",
  system: "Sistema",
  back: "Menu principal",
};

const legacyAdminLabels = {
  open: ["/admin", "Painel admin", "Admin", "⚙️ Admin"],
  status: ["Status", "📊 Status"],
  media: ["Midias", "Mídias", "🖼️ Midias", "🖼️ Mídias"],
  users: ["Usuarios", "Usuários", "👥 Usuarios", "👥 Usuários"],
  system: ["Sistema", "🛠️ Sistema"],
  back: ["Menu principal", "Voltar menu", "⬅️ Menu principal"],
};

function normalizeButtonText(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

function matchesButton(text: string, current: string, legacy: string[] = []) {
  const normalized = normalizeButtonText(text);
  return [current, ...legacy].some((label) => normalizeButtonText(label) === normalized);
}

type AdminPanelPage =
  | "home"
  | "status"
  | "status_errors"
  | "status_logs"
  | "media"
  | "media_recent"
  | "media_top"
  | "media_trash"
  | "users"
  | "users_active"
  | "users_blocked"
  | "users_top"
  | "users_commands"
  | "groups"
  | "groups_list"
  | "groups_automations"
  | "groups_commands"
  | "system"
  | "system_limits"
  | "system_messages"
  | "system_admins"
  | "system_backup";

type AdminPanelAction =
  | AdminPanelPage
  | "close"
  | "toggle_maintenance"
  | "toggle_auto_message"
  | "send_latest_media"
  | "media_test_hetero"
  | "media_test_trans"
  | "delete_last_ask"
  | "delete_last_yes"
  | "delete_last_no"
  | "restore_last_ask"
  | "restore_last_yes"
  | "restore_last_no"
  | "noop";

const adminPanelPages = new Set<AdminPanelPage>([
  "home",
  "status",
  "status_errors",
  "status_logs",
  "media",
  "media_recent",
  "media_top",
  "media_trash",
  "users",
  "users_active",
  "users_blocked",
  "users_top",
  "users_commands",
  "groups",
  "groups_list",
  "groups_automations",
  "groups_commands",
  "system",
  "system_limits",
  "system_messages",
  "system_admins",
  "system_backup",
]);

const adminPanelActions = new Set<AdminPanelAction>([
  ...adminPanelPages,
  "close",
  "toggle_maintenance",
  "toggle_auto_message",
  "send_latest_media",
  "media_test_hetero",
  "media_test_trans",
  "delete_last_ask",
  "delete_last_yes",
  "delete_last_no",
  "restore_last_ask",
  "restore_last_yes",
  "restore_last_no",
  "noop",
]);

type AdminPermissionKey =
  | "can_delete_media"
  | "can_restore_media"
  | "can_manage_users"
  | "can_manage_settings"
  | "can_view_stats";

function requiredAdminPermission(action: AdminPanelAction): AdminPermissionKey | null {
  if (action.startsWith("delete_last")) return "can_delete_media";
  if (action.startsWith("restore_last")) return "can_restore_media";
  if (action === "toggle_maintenance" || action === "toggle_auto_message") {
    return "can_manage_settings";
  }
  if (action.startsWith("users") || action === "system_admins") return "can_manage_users";
  if (action.startsWith("system")) return "can_manage_settings";
  if (
    action.startsWith("status") ||
    action.startsWith("media") ||
    action.startsWith("groups") ||
    action === "send_latest_media"
  ) {
    return "can_view_stats";
  }
  return null;
}

function hasAdminPermission(
  permissions: ImageBotAdminPermissionRow | null,
  permission: AdminPermissionKey,
) {
  return Boolean(permissions?.[permission]);
}

const shortDateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function escapeTelegramHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "nunca";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "nunca" : shortDateTime.format(date);
}

function isAdminPanelPage(value: string): value is AdminPanelPage {
  return adminPanelPages.has(value as AdminPanelPage);
}

function isAdminPanelAction(value: string): value is AdminPanelAction {
  return adminPanelActions.has(value as AdminPanelAction);
}

function adminMainRows(): InlineKeyboard {
  return [
    [
      { text: "Status", callback_data: "iadm:status" },
      { text: "Midias", callback_data: "iadm:media" },
    ],
    [
      { text: "Usuarios", callback_data: "iadm:users" },
      { text: "Grupos", callback_data: "iadm:groups" },
    ],
    [
      { text: "Sistema", callback_data: "iadm:system" },
      { text: "Fechar", callback_data: "iadm:close" },
    ],
  ];
}

function adminFooterRows(): InlineKeyboard {
  return [
    [
      { text: "Menu admin", callback_data: "iadm:home" },
      { text: "Fechar", callback_data: "iadm:close" },
    ],
  ];
}

function adminPanelKeyboard(page: AdminPanelPage, settings: ImageBotSettingsRow): InlineKeyboard {
  if (page === "home") return adminMainRows();

  const refreshRow: InlineKeyboard[number] = [{ text: "Atualizar", callback_data: `iadm:${page}` }];
  const backToSection = (section: AdminPanelPage): InlineKeyboard[number] => [
    { text: "Voltar", callback_data: `iadm:${section}` },
  ];

  if (page.startsWith("status")) {
    return [
      refreshRow,
      [
        { text: "Resumo", callback_data: "iadm:status" },
        { text: "Erros", callback_data: "iadm:status_errors" },
      ],
      [{ text: "Logs", callback_data: "iadm:status_logs" }],
      ...adminFooterRows(),
    ];
  }

  if (page === "media") {
    return [
      [{ text: "Enviar ultima midia", callback_data: "iadm:send_latest_media" }],
      refreshRow,
      [
        { text: "Ultimas", callback_data: "iadm:media_recent" },
        { text: "Top favoritas", callback_data: "iadm:media_top" },
      ],
      [
        { text: "Teste Hetero", callback_data: "iadm:media_test_hetero" },
        { text: "Teste Trans", callback_data: "iadm:media_test_trans" },
      ],
      [
        { text: "Lixeira", callback_data: "iadm:media_trash" },
        { text: "Excluir ultima", callback_data: "iadm:delete_last_ask" },
      ],
      ...adminFooterRows(),
    ];
  }

  if (page === "media_recent" || page === "media_top") {
    return [refreshRow, backToSection("media"), ...adminFooterRows()];
  }

  if (page === "media_trash") {
    return [
      refreshRow,
      [
        { text: "Restaurar ultima", callback_data: "iadm:restore_last_ask" },
        { text: "Voltar", callback_data: "iadm:media" },
      ],
      ...adminFooterRows(),
    ];
  }

  if (page.startsWith("users")) {
    return [
      refreshRow,
      [
        { text: "Resumo", callback_data: "iadm:users" },
        { text: "Ativos", callback_data: "iadm:users_active" },
      ],
      [
        { text: "Bloqueados", callback_data: "iadm:users_blocked" },
        { text: "Mais ativos", callback_data: "iadm:users_top" },
      ],
      [{ text: "Comandos", callback_data: "iadm:users_commands" }],
      ...adminFooterRows(),
    ];
  }

  if (page.startsWith("groups")) {
    return [
      refreshRow,
      [
        { text: "Lista", callback_data: "iadm:groups_list" },
        { text: "Automacoes", callback_data: "iadm:groups_automations" },
      ],
      [{ text: "Comandos", callback_data: "iadm:groups_commands" }],
      ...adminFooterRows(),
    ];
  }

  if (page.startsWith("system")) {
    return [
      [
        {
          text: settings.maintenance_enabled ? "Desativar manutencao" : "Ativar manutencao",
          callback_data: "iadm:toggle_maintenance",
        },
      ],
      [
        {
          text: settings.auto_message_enabled ? "Pausar automsg" : "Ativar automsg",
          callback_data: "iadm:toggle_auto_message",
        },
      ],
      refreshRow,
      [{ text: "Limites", callback_data: "iadm:system_limits" }],
      [
        { text: "Mensagens", callback_data: "iadm:system_messages" },
        { text: "Admins", callback_data: "iadm:system_admins" },
      ],
      [{ text: "Backup", callback_data: "iadm:system_backup" }],
      ...adminFooterRows(),
    ];
  }

  return [...adminMainRows(), ...adminFooterRows()];
}

function adminConfirmKeyboard(action: "delete_last" | "restore_last"): InlineKeyboard {
  return [
    [
      { text: "Confirmar", callback_data: `iadm:${action}_yes` },
      { text: "Cancelar", callback_data: `iadm:${action}_no` },
    ],
    [
      {
        text: "Voltar",
        callback_data: action === "delete_last" ? "iadm:media" : "iadm:media_trash",
      },
    ],
  ];
}

function formatAdminHomeMessage() {
  return [
    "<b>Painel Admin</b>",
    "",
    "Controle rapido do UpMidias pelo proprio Telegram.",
    "Use os botoes abaixo para navegar. Esta mensagem sera editada, sem criar varias mensagens novas.",
  ].join("\n");
}

function formatAdminPanelMessage(page: AdminPanelPage, settings: ImageBotSettingsRow) {
  if (page === "status") return formatAdminStatusMessage();
  if (page === "status_errors") return formatAdminStatusErrorsMessage();
  if (page === "status_logs") return formatAdminAuditLogsMessage();
  if (page === "media") return formatAdminMediaMessage();
  if (page === "media_recent") return formatAdminRecentMediaMessage();
  if (page === "media_top") return formatAdminTopMediaMessage();
  if (page === "media_trash") return formatAdminTrashMessage();
  if (page === "users") return formatAdminUsersMessage();
  if (page === "users_active") return formatAdminActiveUsersMessage();
  if (page === "users_blocked") return formatAdminBlockedUsersMessage();
  if (page === "users_top") return formatAdminTopUsersMessage();
  if (page === "users_commands") return formatAdminUserCommandsMessage();
  if (page === "groups") return formatAdminGroupsMessage();
  if (page === "groups_list") return formatAdminGroupListMessage();
  if (page === "groups_automations") return formatAdminGroupAutomationsMessage();
  if (page === "groups_commands") return formatAdminGroupCommandsMessage();
  if (page === "system") return formatAdminSystemMessage(settings);
  if (page === "system_limits") return formatAdminSystemLimitsMessage(settings);
  if (page === "system_messages") return formatAdminSystemMessagesMessage(settings);
  if (page === "system_admins") return formatAdminSystemAdminsMessage();
  if (page === "system_backup") return formatAdminSystemBackupMessage();
  return formatAdminHomeMessage();
}

async function editAdminPanelMessage(input: {
  token: string;
  chatId: number;
  messageId: number;
  page: AdminPanelPage;
  settings: ImageBotSettingsRow;
}) {
  try {
    await editMessageTextWithToken(
      input.token,
      input.chatId,
      input.messageId,
      formatAdminPanelMessage(input.page, input.settings),
      adminPanelKeyboard(input.page, input.settings),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("message is not modified")) throw error;
  }
}

function imageCategoryMenu(settings: ImageBotSettingsRow, _isAdmin = false): ReplyKeyboard {
  return {
    ...categoryMenu,
    keyboard: [[{ text: settings.category_hetero_label }, { text: settings.category_trans_label }]],
  };
}

function imageMediaMenu(
  settings: ImageBotSettingsRow,
  _isAdmin = false,
  telegramUserId?: number,
): ReplyKeyboard {
  const showPremiumOffer = !telegramUserId || !hasLifetimeImageBotPremiumAccess(telegramUserId);
  return {
    ...mediaMenu,
    keyboard: [
      [{ text: settings.random_button_label }, { text: settings.favorites_button_label }],
      ...(showPremiumOffer ? [[{ text: settings.premium_offer_button_label }]] : []),
      [{ text: settings.back_button_label }],
    ],
  };
}

function imageCategoryLabel(settings: ImageBotSettingsRow, category: "hetero" | "trans") {
  return category === "hetero" ? settings.category_hetero_label : settings.category_trans_label;
}

function selectedCategoryFromText(text: string, settings: ImageBotSettingsRow) {
  if (matchesButton(text, settings.category_hetero_label, legacyCategoryLabels.hetero)) {
    return "hetero" as const;
  }
  if (matchesButton(text, settings.category_trans_label, legacyCategoryLabels.trans)) {
    return "trans" as const;
  }
  return null;
}

function renderImageBotText(
  template: string,
  values: Partial<
    Record<
      "categoria" | "retry_after" | "inicio" | "fim" | "valor" | "quantidade" | "validade",
      string | number
    >
  > = {},
) {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatImageBotCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function getAvailability(settings: ImageBotSettingsRow) {
  if (settings.maintenance_enabled) {
    return { status: "maintenance" as const, message: settings.maintenance_message };
  }
  return { status: "open" as const, message: "" };
}

async function sendAutoMessageAfterDelivery(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  settings: ImageBotSettingsRow;
  deliveredCount: number;
  isAdmin?: boolean;
}) {
  const every = input.settings.auto_message_every;
  if (!input.settings.auto_message_enabled || every < 1 || !input.settings.auto_message_text)
    return;
  if (input.deliveredCount < 1 || input.deliveredCount % every !== 0) return;
  let keyboard: InlineKeyboard | undefined;
  if (input.settings.auto_message_plan_mode === "all") {
    keyboard = [[{ text: "Planos Premium", callback_data: "ipremium:menu:offer" }]];
  } else if (
    input.settings.auto_message_plan_mode === "single" &&
    input.settings.auto_message_plan_id
  ) {
    const plan = getImageBotPremiumPlan(input.settings.auto_message_plan_id);
    if (plan?.is_active) {
      keyboard = [
        [
          {
            text: plan.name.slice(0, 64),
            callback_data: `ipremium:plan:offer:${plan.id}`,
          },
        ],
      ];
    }
  }
  await sendMessageWithToken(input.token, input.chatId, input.settings.auto_message_text, keyboard);
}

type AdminUserRow = ReturnType<typeof getImageBotUsers>[number];
type AdminMediaRow = ReturnType<typeof getRecentImageBotMedia>[number];

function formatAdminUserName(user: AdminUserRow) {
  return escapeTelegramHtml(
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
      user.username ||
      String(user.telegram_user_id),
  );
}

function formatAdminMediaLine(media: AdminMediaRow, index: number) {
  const title = media.caption?.trim()
    ? escapeTelegramHtml(media.caption.trim().slice(0, 32))
    : media.id.slice(0, 8);
  return `${index + 1}. ${media.category}/${media.media_type} - ${title} - fav ${media.favorite_count} - env ${media.delivery_count}`;
}

function formatAdminStatusMessage() {
  const stats = getImageBotAdminStats();
  const users = getImageBotUsers();
  const groups = getImageBotGroups();
  const activeGroups = groups.filter((group) => group.is_active).length;
  const admins = users.filter((user) => user.is_admin).length;

  return [
    "<b>Painel Admin - Status</b>",
    "",
    `Usuarios: ${users.length}`,
    `Admins: ${admins}`,
    `Grupos ativos: ${activeGroups}/${groups.length}`,
    "",
    `Entregues hoje: ${stats.delivered.today.total} (${stats.delivered.today.photos} fotos / ${stats.delivered.today.videos} videos)`,
    `Entregues semana: ${stats.delivered.week.total}`,
    `Entregues mes: ${stats.delivered.month.total}`,
    "",
    `Usuarios ativos hoje: ${stats.activeUsers.today}`,
    `Erros hoje: ${stats.telegramErrors.today}`,
    `Taxa de erro mes: ${stats.telegramErrors.monthRate}%`,
  ].join("\n");
}

function formatAdminStatusErrorsMessage() {
  const stats = getImageBotAdminStats();
  const errors = getImageBotTelegramErrors(6);
  return [
    "<b>Status - Erros Telegram</b>",
    "",
    `Hoje: ${stats.telegramErrors.today}`,
    `Semana: ${stats.telegramErrors.week}`,
    `Mes: ${stats.telegramErrors.month}`,
    `Taxa no mes: ${stats.telegramErrors.monthRate}%`,
    "",
    "Ultimos erros:",
    ...(errors.length
      ? errors.map(
          (error, index) =>
            `${index + 1}. ${formatShortDate(error.created_at)} - ${escapeTelegramHtml(error.action)} - ${escapeTelegramHtml(error.error_message.slice(0, 90))}`,
        )
      : ["Nenhum erro registrado."]),
  ].join("\n");
}

function formatAdminAuditLogsMessage() {
  const logs = getImageBotAuditLogs(8);
  return [
    "<b>Status - Logs recentes</b>",
    "",
    ...(logs.length
      ? logs.map(
          (log, index) =>
            `${index + 1}. ${formatShortDate(log.created_at)} - ${escapeTelegramHtml(log.action)} - ${escapeTelegramHtml(log.actor_id ?? "sistema")}`,
        )
      : ["Nenhum log registrado ainda."]),
  ].join("\n");
}

function formatAdminMediaMessage() {
  const media = getImageBotMediaSummary();

  return [
    "<b>Painel Admin - Midias</b>",
    "",
    `Total: ${media.total}`,
    `Ativas: ${media.active}`,
    `Desativadas: ${media.inactive}`,
    `Fotos: ${media.photos}`,
    `Videos: ${media.videos}`,
    `Hetero: ${media.hetero}`,
    `Trans: ${media.trans}`,
    "",
    `Favoritos totais: ${media.favorites}`,
    `Entregas totais: ${media.deliveries}`,
    "",
    "Acoes rapidas: testar midia, ver favoritas, lixeira e excluir ultima.",
  ].join("\n");
}

function formatAdminRecentMediaMessage() {
  const media = getRecentImageBotMedia(8);
  return [
    "<b>Midias - Ultimas salvas</b>",
    "",
    ...(media.length ? media.map(formatAdminMediaLine) : ["Nenhuma midia salva ainda."]),
  ].join("\n");
}

function formatAdminTopMediaMessage() {
  const media = getTopImageBotMedia(8);
  return [
    "<b>Midias - Top favoritas</b>",
    "",
    ...(media.length ? media.map(formatAdminMediaLine) : ["Nenhuma midia favoritada ainda."]),
  ].join("\n");
}

function formatAdminTrashMessage() {
  const deleted = getImageBotDeletedMedia().slice(0, 8);
  return [
    "<b>Midias - Lixeira</b>",
    "",
    ...(deleted.length
      ? deleted.map(
          (media, index) =>
            `${index + 1}. ${media.category}/${media.media_type} - ${formatShortDate(media.deleted_at)} - por ${escapeTelegramHtml(media.deleted_by ?? "desconhecido")}`,
        )
      : ["Lixeira vazia."]),
  ].join("\n");
}

function formatAdminUsersMessage() {
  const users = getImageBotUsers();
  const active24h = Date.now() - 24 * 60 * 60 * 1000;
  const activeToday = users.filter((user) => Date.parse(user.last_activity_at) >= active24h);
  const blocked = users.filter((user) => user.is_blocked);
  const admins = users.filter((user) => user.is_admin);

  return [
    "<b>Painel Admin - Usuarios</b>",
    "",
    `Total: ${users.length}`,
    `Ativos 24h: ${activeToday.length}`,
    `Bloqueados: ${blocked.length}`,
    `Admins: ${admins.length}`,
    "",
    "Use os submenus para ver ativos, bloqueados, mais ativos e comandos por ID.",
  ].join("\n");
}

function formatAdminActiveUsersMessage() {
  const active24h = Date.now() - 24 * 60 * 60 * 1000;
  const users = getImageBotUsers()
    .filter((user) => Date.parse(user.last_activity_at) >= active24h)
    .slice(0, 8);
  return [
    "<b>Usuarios - Ativos 24h</b>",
    "",
    ...(users.length
      ? users.map(
          (user, index) =>
            `${index + 1}. ${formatAdminUserName(user)} - <code>${user.telegram_user_id}</code> - ${user.media_delivered_count} midias`,
        )
      : ["Nenhum usuario ativo nas ultimas 24h."]),
  ].join("\n");
}

function formatAdminBlockedUsersMessage() {
  const users = getImageBotUsers()
    .filter((user) => user.is_blocked)
    .slice(0, 8);
  return [
    "<b>Usuarios - Bloqueados</b>",
    "",
    ...(users.length
      ? users.map(
          (user, index) =>
            `${index + 1}. ${formatAdminUserName(user)} - <code>${user.telegram_user_id}</code>`,
        )
      : ["Nenhum usuario bloqueado."]),
  ].join("\n");
}

function formatAdminTopUsersMessage() {
  const users = [...getImageBotUsers()]
    .sort((left, right) => right.media_delivered_count - left.media_delivered_count)
    .slice(0, 8);
  return [
    "<b>Usuarios - Mais ativos</b>",
    "",
    ...(users.length
      ? users.map(
          (user, index) =>
            `${index + 1}. ${formatAdminUserName(user)} - <code>${user.telegram_user_id}</code> - ${user.media_delivered_count} midias - fav ${user.favorite_count}`,
        )
      : ["Nenhum usuario registrado ainda."]),
  ].join("\n");
}

function formatAdminUserCommandsMessage() {
  return [
    "<b>Usuarios - Comandos por ID</b>",
    "",
    "<code>/usuario 123</code> - ver historico e favoritos",
    "<code>/bloquear 123</code> - bloquear usuario",
    "<code>/desbloquear 123</code> - desbloquear usuario",
    "<code>/msg 123 texto</code> - enviar mensagem individual",
    "",
    "Use o ID que aparece nas listas do submenu Usuarios.",
  ].join("\n");
}

function formatAdminGroupsMessage() {
  const groups = getImageBotGroups();
  const activeGroups = groups.filter((group) => group.is_active);
  const automationTotal = groups.reduce(
    (sum, group) => sum + getImageBotGroupAutomations(group.id).length,
    0,
  );

  return [
    "<b>Painel Admin - Grupos</b>",
    "",
    `Grupos detectados: ${groups.length}`,
    `Ativos: ${activeGroups.length}`,
    `Automacoes: ${automationTotal}`,
    "",
    "Aqui voce ve onde o bot esta e acompanha automacoes dos grupos.",
  ].join("\n");
}

function formatAdminGroupListMessage() {
  const groups = getImageBotGroups().slice(0, 8);
  return [
    "<b>Grupos - Lista</b>",
    "",
    ...(groups.length
      ? groups.map(
          (group, index) =>
            `${index + 1}. ${escapeTelegramHtml(group.title)} - ${group.category ?? "sem categoria"} - ${group.is_active ? "ativo" : "inativo"} - <code>${group.telegram_chat_id}</code>`,
        )
      : ["Nenhum grupo detectado ainda."]),
  ].join("\n");
}

function formatAdminGroupAutomationsMessage() {
  const groups = getImageBotGroups();
  const rows = groups
    .flatMap((group) =>
      getImageBotGroupAutomations(group.id).map((automation) => ({ group, automation })),
    )
    .slice(0, 8);

  return [
    "<b>Grupos - Automacoes</b>",
    "",
    ...(rows.length
      ? rows.map(
          ({ group, automation }, index) =>
            `${index + 1}. ${escapeTelegramHtml(group.title)} - ${escapeTelegramHtml(automation.title)} - ${automation.interval_minutes}min - ${automation.is_active ? "ativa" : "pausada"}`,
        )
      : ["Nenhuma automacao de grupo criada."]),
  ].join("\n");
}

function formatAdminGroupCommandsMessage() {
  return [
    "<b>Grupos - Comandos</b>",
    "",
    "Criar/editar automacoes com texto, foto, video e midia do banco continua melhor no painel web.",
    "",
    "Pelo bot, este menu serve para acompanhar grupos, ver automacoes e confirmar se o bot esta ativo.",
  ].join("\n");
}

function formatAdminSystemMessage(settings: ImageBotSettingsRow) {
  return [
    "<b>Painel Admin - Sistema</b>",
    "",
    `Manutencao: ${settings.maintenance_enabled ? "ativa" : "desativada"}`,
    "Funcionamento: 24 horas",
    `Mensagem automatica: ${settings.auto_message_enabled ? "ativa" : "desativada"}`,
    "",
    "Use os botoes para alternar manutencao e mensagens automaticas.",
  ].join("\n");
}

function formatAdminSystemLimitsMessage(settings: ImageBotSettingsRow) {
  return [
    "<b>Sistema - Limites</b>",
    "",
    `Cooldown por pedido: ${settings.flood_cooldown_seconds}s`,
    `Pedidos por minuto: ${settings.flood_limit_per_minute}`,
    `Midias por dia: ${settings.daily_media_limit || "ilimitado"}`,
    "",
    "Para alterar numeros com precisao, use o painel web. Pelo bot voce consegue consultar rapido.",
  ].join("\n");
}

function formatAdminSystemMessagesMessage(settings: ImageBotSettingsRow) {
  return [
    "<b>Sistema - Mensagens</b>",
    "",
    `Boas-vindas: ${escapeTelegramHtml(settings.welcome_message.slice(0, 120))}`,
    `Categoria: ${escapeTelegramHtml(settings.category_prompt.slice(0, 120))}`,
    `Midia: ${escapeTelegramHtml(settings.media_prompt.slice(0, 120))}`,
    `Auto msg: ${settings.auto_message_enabled ? "ativa" : "desativada"} a cada ${settings.auto_message_every} pedidos`,
    "",
    "Textos longos continuam mais confortaveis no painel web.",
  ].join("\n");
}

function formatAdminSystemAdminsMessage() {
  const admins = getImageBotAdminPermissions().slice(0, 8);
  return [
    "<b>Sistema - Administradores</b>",
    "",
    ...(admins.length
      ? admins.map((admin, index) => {
          const name = escapeTelegramHtml(
            [admin.first_name, admin.last_name].filter(Boolean).join(" ") ||
              admin.username ||
              String(admin.telegram_user_id),
          );
          return `${index + 1}. ${name} - <code>${admin.telegram_user_id}</code> - ${admin.role}`;
        })
      : ["Nenhum admin extra cadastrado."]),
    "",
    "<code>/adminadd 123 manager</code>",
    "<code>/adminadd 123 moderator</code>",
    "<code>/adminadd 123 viewer</code>",
    "<code>/adminrem 123</code>",
  ].join("\n");
}

function formatAdminSystemBackupMessage() {
  return [
    "<b>Sistema - Backup</b>",
    "",
    "O banco do UpMidias e local em SQLite.",
    "Backup e restauracao completos continuam no painel web para evitar toque acidental pelo Telegram.",
    "",
    "Dica: antes de grandes mudancas, faca backup pelo painel e depois teste no bot.",
  ].join("\n");
}

async function handleAdminTextCommand(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  text: string;
  permissions: ImageBotAdminPermissionRow;
}) {
  if (!input.text.startsWith("/")) return false;

  const [rawCommand, ...args] = input.text.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const targetId = Number(args[0]);
  const targetIsValid = Number.isInteger(targetId) && targetId > 0;
  const reply = (message: string) => sendMessageWithToken(input.token, input.chatId, message);
  const requirePermission = async (permission: AdminPermissionKey) => {
    if (hasAdminPermission(input.permissions, permission)) return true;
    await reply("Voce nao possui permissao para executar este comando.");
    return false;
  };

  if (command === "/usuario") {
    if (!(await requirePermission("can_manage_users"))) return true;
    if (!targetIsValid) {
      await reply("Use: <code>/usuario 123</code>");
      return true;
    }
    const details = getImageBotUserDetails(targetId);
    if (!details) {
      await reply("Usuario nao encontrado no banco.");
      return true;
    }
    const user = details.user;
    await reply(
      [
        "<b>Usuario</b>",
        "",
        `Nome: ${formatAdminUserName(user)}`,
        `ID: <code>${user.telegram_user_id}</code>`,
        `Status: ${user.is_blocked ? "bloqueado" : "liberado"}`,
        `Admin: ${user.is_admin ? "sim" : "nao"}`,
        `Premium UpMidias: ${user.is_premium ? "sim" : "nao"}`,
        `Premium Telegram: ${user.is_telegram_premium ? "sim" : "nao"}`,
        `Midias entregues: ${user.media_delivered_count}`,
        `Favoritos: ${details.favorites.length}`,
        `Eventos: ${details.activity.length}`,
        `Ultima atividade: ${formatShortDate(user.last_activity_at)}`,
      ].join("\n"),
    );
    return true;
  }

  if (command === "/bloquear" || command === "/desbloquear") {
    if (!(await requirePermission("can_manage_users"))) return true;
    if (!targetIsValid) {
      await reply(`Use: <code>${command} 123</code>`);
      return true;
    }
    const blocked = command === "/bloquear";
    const changed = setImageBotUserBlocked(targetId, blocked);
    await reply(
      changed
        ? `Usuario <code>${targetId}</code> ${blocked ? "bloqueado" : "desbloqueado"}.`
        : "Usuario nao encontrado no banco.",
    );
    return true;
  }

  if (command === "/msg") {
    if (!(await requirePermission("can_manage_users"))) return true;
    const match = input.text.match(/^\/msg\s+(\d+)\s+([\s\S]+)/i);
    if (!match) {
      await reply("Use: <code>/msg 123 sua mensagem aqui</code>");
      return true;
    }
    const targetChatId = Number(match[1]);
    const message = match[2].trim();
    if (!message) {
      await reply("A mensagem nao pode ficar vazia.");
      return true;
    }
    try {
      await sendMessageWithToken(input.token, targetChatId, escapeTelegramHtml(message));
      await reply(`Mensagem enviada para <code>${targetChatId}</code>.`);
    } catch (error) {
      recordImageBotTelegramError({
        action: "admin-direct-message",
        chatId: targetChatId,
        telegramUserId: input.telegramUserId,
        error,
      });
      await reply("Nao consegui enviar. Talvez o usuario nunca tenha iniciado o bot.");
    }
    return true;
  }

  if (command === "/adminadd") {
    if (!(await requirePermission("can_manage_users"))) return true;
    const role =
      args[1] === "viewer" || args[1] === "moderator" || args[1] === "manager"
        ? args[1]
        : "manager";
    if (!targetIsValid) {
      await reply("Use: <code>/adminadd 123 manager</code>");
      return true;
    }
    upsertImageBotAdminPermission({
      telegramUserId: targetId,
      role,
      canDeleteMedia: role !== "viewer",
      canRestoreMedia: role !== "viewer",
      canManageUsers: role === "manager",
      canManageSettings: role === "manager",
      canViewStats: true,
      actor: `telegram:${input.telegramUserId}`,
    });
    await reply(`Admin <code>${targetId}</code> cadastrado como ${role}.`);
    return true;
  }

  if (command === "/adminrem") {
    if (!(await requirePermission("can_manage_users"))) return true;
    if (!targetIsValid) {
      await reply("Use: <code>/adminrem 123</code>");
      return true;
    }
    const removed = removeImageBotAdminPermission(targetId, `telegram:${input.telegramUserId}`);
    await reply(
      removed ? `Admin <code>${targetId}</code> removido.` : "Admin nao encontrado ou ja removido.",
    );
    return true;
  }

  if (command === "/teste") {
    if (!(await requirePermission("can_manage_settings"))) return true;
    const message = input.text.replace(/^\/teste\s*/i, "").trim() || "Teste do painel admin.";
    await reply(`Teste: ${escapeTelegramHtml(message)}`);
    return true;
  }

  return false;
}

async function sendAdminRandomTestMedia(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  category: "hetero" | "trans";
  isAdmin: boolean;
}) {
  const media = getRandomActiveImageBotMedia(input.category);
  if (!media) {
    await sendMessageWithToken(
      input.token,
      input.chatId,
      `Nao encontrei midias ativas na categoria ${input.category}.`,
    );
    return { status: "empty" as const };
  }

  if (media.media_type === "photo") {
    await sendPhotoWithToken(
      input.token,
      input.chatId,
      media.file_id,
      "",
      mediaActions(media.id, false, input.isAdmin, input.telegramUserId),
    );
  } else {
    await sendVideoWithToken(
      input.token,
      input.chatId,
      media.file_id,
      "",
      mediaActions(media.id, false, input.isAdmin, input.telegramUserId),
    );
  }

  recordImageBotMediaDelivery({
    telegramUserId: input.telegramUserId,
    media,
    source: "random",
  });
  return { status: "sent" as const };
}

async function sendAdminLatestMedia(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  isAdmin: boolean;
}) {
  const media = getLatestActiveImageBotMedia();
  if (!media) {
    await sendMessageWithToken(input.token, input.chatId, "Nenhuma midia cadastrada no banco.");
    return { status: "empty" as const };
  }

  const caption = [
    "<b>Ultima midia cadastrada</b>",
    "",
    `Categoria: ${media.category === "hetero" ? "Hetero" : "Trans"}`,
    `Tipo: ${media.media_type === "photo" ? "Foto" : "Video"}`,
    `Cadastrada em: ${formatShortDate(media.created_at)}`,
  ].join("\n");
  const keyboard = mediaActions(media.id, false, input.isAdmin, input.telegramUserId);

  if (media.media_type === "photo") {
    await sendPhotoWithToken(input.token, input.chatId, media.file_id, caption, keyboard);
  } else {
    await sendVideoWithToken(input.token, input.chatId, media.file_id, caption, keyboard);
  }
  return { status: "sent" as const, mediaId: media.id };
}

function premiumOfferInlineRow(telegramUserId?: number): InlineKeyboard[number] | null {
  if (telegramUserId && hasLifetimeImageBotPremiumAccess(telegramUserId)) return null;
  const label = getImageBotSettings().premium_offer_button_label.trim();
  return label ? [{ text: label.slice(0, 64), callback_data: "ifull:noop" }] : null;
}

const mediaActions = (
  mediaId: string,
  favorited = false,
  isAdmin = false,
  telegramUserId?: number,
): InlineKeyboard => {
  const actions: InlineKeyboard[number] = [
    {
      text: favorited ? "💔 Remover favorito" : "⭐ Favoritar",
      callback_data: favorited ? `iunfav:${mediaId}` : `ifav:${mediaId}`,
    },
  ];
  if (isAdmin) {
    actions.push({
      text: "Excluir",
      callback_data: `idel:ask:${favorited ? "v" : "r"}:${mediaId}`,
    });
  }
  const premiumRow = premiumOfferInlineRow(telegramUserId);
  return premiumRow ? [actions, premiumRow] : [actions];
};

function premiumPlanValidityLabel(plan: ImageBotPremiumPlanRow) {
  return plan.access_type === "lifetime"
    ? "Vitalicio"
    : `${plan.access_days} dia${plan.access_days === 1 ? "" : "s"}`;
}

function premiumPlanFeatures(plan: ImageBotPremiumPlanRow) {
  const features = [
    plan.allow_favorites ? "Favoritos liberados" : "Sem favoritos",
    `Delay entre midias: ${plan.media_cooldown_seconds}s`,
    plan.daily_media_limit > 0
      ? `Limite diario: ${plan.daily_media_limit} midias`
      : "Limite diario do plano gratis",
  ];
  return features.map((feature) => `• ${escapeTelegramHtml(feature)}`).join("\n");
}

type PremiumMenuContext = "limit" | "offer" | "favorite";

const premiumPlansKeyboard = (context: PremiumMenuContext): InlineKeyboard => {
  const plans = getImageBotPremiumPlans({ activeOnly: true });
  return plans.map((plan) => [
    {
      text: plan.name.slice(0, 64),
      callback_data: `ipremium:plan:${context}:${plan.id}`,
    },
  ]);
};

function premiumMenuText(intro?: string) {
  const plans = getImageBotPremiumPlans({ activeOnly: true });
  const safeIntro = intro?.trim();
  if (safeIntro) return escapeTelegramHtml(safeIntro);
  return plans.length
    ? "<b>Planos Premium</b>\n\nEscolha um plano abaixo para ver os detalhes."
    : "Nenhum plano Premium ativo agora.";
}

function premiumPlanDetailText(plan: ImageBotPremiumPlanRow) {
  const description = plan.description?.trim() || "Sem descricao cadastrada.";
  return [
    `<b>${escapeTelegramHtml(plan.name)}</b>`,
    "",
    escapeTelegramHtml(description),
    "",
    `<b>Valor:</b> ${formatImageBotCurrency(Number(plan.price))}`,
    `<b>Validade:</b> ${premiumPlanValidityLabel(plan)}`,
    "",
    "<b>Recursos:</b>",
    premiumPlanFeatures(plan),
  ].join("\n");
}

function premiumPlanDetailKeyboard(
  plan: ImageBotPremiumPlanRow,
  context: PremiumMenuContext,
): InlineKeyboard {
  return [
    [
      {
        text: `Comprar por ${formatImageBotCurrency(Number(plan.price))}`.slice(0, 64),
        callback_data: `ipremium:buy:${plan.id}`,
      },
    ],
    [{ text: "Voltar aos planos", callback_data: `ipremium:menu:${context}` }],
  ];
}

async function editOrSendPremiumMenu(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  messageId?: number;
  intro?: string;
  reuseOnly?: boolean;
  forceNew?: boolean;
  context: PremiumMenuContext;
}) {
  const keyboard = premiumPlansKeyboard(input.context);
  const text = premiumMenuText(input.intro);
  const messageId = input.forceNew
    ? undefined
    : (input.messageId ?? getImageBotPremiumMessageId(input.telegramUserId) ?? undefined);
  if (!keyboard.length) {
    if (messageId) {
      try {
        await editMessageTextWithToken(input.token, input.chatId, messageId, text);
        setImageBotPremiumMessageId(input.telegramUserId, messageId);
        return messageId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("message is not modified")) return messageId;
        console.warn("[image-premium-empty-menu-edit]", error);
        if (input.reuseOnly) return null;
      }
    }
    const response = await sendMessageWithToken(input.token, input.chatId, text);
    const sentMessageId = Number(response.result?.message_id);
    if (Number.isInteger(sentMessageId)) {
      setImageBotPremiumMessageId(input.telegramUserId, sentMessageId);
      return sentMessageId;
    }
    return null;
  }
  if (messageId) {
    try {
      await editMessageTextWithToken(input.token, input.chatId, messageId, text, keyboard);
      setImageBotPremiumMessageId(input.telegramUserId, messageId);
      return messageId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("message is not modified")) return messageId;
      console.warn("[image-premium-menu-edit-fallback]", error);
      if (input.reuseOnly) return null;
    }
  }
  const response = await sendMessageWithToken(input.token, input.chatId, text, keyboard);
  const sentMessageId = Number(response.result?.message_id);
  if (Number.isInteger(sentMessageId)) {
    setImageBotPremiumMessageId(input.telegramUserId, sentMessageId);
    return sentMessageId;
  }
  return null;
}

async function editPremiumPlanDetail(input: {
  token: string;
  chatId: number;
  messageId: number;
  plan: ImageBotPremiumPlanRow;
  context: PremiumMenuContext;
}) {
  await editMessageTextWithToken(
    input.token,
    input.chatId,
    input.messageId,
    premiumPlanDetailText(input.plan),
    premiumPlanDetailKeyboard(input.plan, input.context),
  );
}

async function sendPremiumRequiredMessage(input: {
  token: string;
  chatId: number;
  telegramUserId: number;
  messageId?: number;
  intro?: string;
  reuseOnly?: boolean;
  forceNew?: boolean;
  context?: PremiumMenuContext;
}) {
  await editOrSendPremiumMenu({
    ...input,
    context: input.context ?? "offer",
    intro:
      input.intro ?? "Recurso Premium\n\nEscolha um plano para ver os detalhes e ativar pelo Pix.",
  });
}

const favoriteNavigation = (
  mediaId: string,
  index: number,
  total: number,
  isAdmin = false,
  telegramUserId?: number,
): InlineKeyboard => {
  const keyboard: InlineKeyboard = [
    [
      { text: "《", callback_data: `fnav:p:${mediaId}` },
      { text: `${index} / ${total}`, callback_data: "fnav:count" },
      { text: "》", callback_data: `fnav:n:${mediaId}` },
    ],
    [{ text: "💔 Remover favorito", callback_data: `frem:ask:${mediaId}` }],
  ];
  if (isAdmin) {
    keyboard.push([{ text: "Excluir", callback_data: `idel:ask:f:${mediaId}` }]);
  }
  const premiumRow = premiumOfferInlineRow(telegramUserId);
  if (premiumRow) keyboard.push(premiumRow);
  return keyboard;
};

const deleteConfirmation = (mediaId: string, context: "r" | "v" | "f"): InlineKeyboard => [
  [{ text: "Mover esta mídia para a lixeira?", callback_data: "fnav:count" }],
  [
    { text: "✅ Sim, excluir", callback_data: `idel:yes:${context}:${mediaId}` },
    { text: "❌ Cancelar", callback_data: `idel:no:${context}:${mediaId}` },
  ],
];

const favoriteRemovalConfirmation = (mediaId: string): InlineKeyboard => [
  [{ text: "Remover esta mídia dos favoritos?", callback_data: "fnav:count" }],
  [
    { text: "✅ Sim, remover", callback_data: `frem:yes:${mediaId}` },
    { text: "❌ Cancelar", callback_data: `frem:no:${mediaId}` },
  ],
];

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const Route = createFileRoute("/api/public/telegram/image-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = getManagedBotToken("images");
        if (!token) return new Response("Bot de imagens não configurado", { status: 500 });
        const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        const expectedSecret = deriveManagedBotWebhookSecret("images", token);
        if (!safeEqual(receivedSecret, expectedSecret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 1_000_000) return new Response("Payload muito grande", { status: 413 });

        const settings = getImageBotSettings();
        const update = await request.json();
        const updateId = Number(update.update_id);
        if (Number.isFinite(updateId) && !claimImageBotTelegramUpdate(updateId)) {
          return Response.json({ ok: true, duplicate: true });
        }
        const isGroupChat = (chat: any) => chat?.type === "group" || chat?.type === "supergroup";
        const syncGroup = async (
          chat: any,
          options: { botStatus?: string; isActive?: boolean; loadMemberCount?: boolean } = {},
        ) => {
          if (!isGroupChat(chat)) return;
          let memberCount: number | null | undefined;
          if (options.loadMemberCount && options.isActive) {
            try {
              memberCount = await getChatMemberCountWithToken(token, chat.id);
            } catch (error) {
              console.warn("[image-bot-group-count]", error);
            }
          }
          upsertImageBotGroup({
            telegramChatId: chat.id,
            title: chat.title ?? "Grupo sem título",
            username: chat.username ?? null,
            type: chat.type,
            botStatus: options.botStatus,
            isActive: options.isActive,
            memberCount,
          });
        };

        if (update.my_chat_member) {
          const membership = update.my_chat_member;
          const status = String(membership.new_chat_member?.status ?? "left");
          const isActive = ["creator", "administrator", "member", "restricted"].includes(status);
          await syncGroup(membership.chat, {
            botStatus: status,
            isActive,
            loadMemberCount: true,
          });
          if (isActive) {
            try {
              await clearReplyKeyboardWithToken(token, membership.chat.id);
            } catch (error) {
              console.warn("[image-bot-clear-group-keyboard]", error);
            }
          }
          return Response.json({ ok: true, groupUpdated: true });
        }

        if (update.callback_query) {
          const callback = update.callback_query;
          const callbackData = String(callback.data ?? "");
          const callbackMessage = callback.message;
          const telegramUserId = Number(callback.from?.id);
          const chatId = Number(callbackMessage?.chat?.id);
          const messageId = Number(callbackMessage?.message_id);

          if (!telegramUserId || !chatId || !messageId) {
            await answerCallbackQueryWithToken(token, callback.id);
            return Response.json({ ok: true, callbackIgnored: true });
          }

          upsertImageBotUser({
            telegramUserId,
            username: callback.from?.username ?? null,
            firstName: callback.from?.first_name ?? null,
            lastName: callback.from?.last_name ?? null,
            languageCode: callback.from?.language_code ?? null,
            isBot: Boolean(callback.from?.is_bot),
            isTelegramPremium: Boolean(callback.from?.is_premium),
            telegramProfile: callback.from ?? null,
          });
          const callbackUserIsAdmin = isImageBotUserAdmin(telegramUserId);
          const callbackAdminPermissions = callbackUserIsAdmin
            ? getImageBotAdminPermission(telegramUserId)
            : null;
          if (isImageBotUserBlocked(telegramUserId) && !callbackUserIsAdmin) {
            await answerCallbackQueryWithToken(
              token,
              callback.id,
              "Seu acesso ao bot está bloqueado.",
              true,
            );
            return Response.json({ ok: true, userBlocked: true });
          }
          const callbackAvailability = getAvailability(settings);
          if (callbackAvailability.status !== "open" && !callbackUserIsAdmin) {
            await answerCallbackQueryWithToken(
              token,
              callback.id,
              callbackAvailability.message,
              true,
            );
            return Response.json({ ok: true, botUnavailable: callbackAvailability.status });
          }

          if (callbackData === "iauto:plans") {
            try {
              await sendPremiumRequiredMessage({
                token,
                chatId: telegramUserId,
                telegramUserId,
                context: "offer",
                forceNew: true,
                intro: "Escolha um plano Premium abaixo.",
              });
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Enviei os planos no privado.",
              );
            } catch (error) {
              recordImageBotTelegramError({
                action: "group-automation-premium-menu",
                chatId,
                telegramUserId,
                error,
              });
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Abra o bot no privado e envie /start primeiro.",
                true,
              );
            }
            return Response.json({ ok: true, automationPremiumMenu: true });
          }

          const automationPlan = callbackData.match(/^iauto:plan:([0-9a-f-]{36})$/i);
          if (automationPlan) {
            const plan = getImageBotPremiumPlan(automationPlan[1]);
            if (!plan?.is_active) {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Este plano nao esta ativo.",
                true,
              );
              return Response.json({ ok: true, automationPremiumPlanInactive: true });
            }
            try {
              await sendMessageWithToken(
                token,
                telegramUserId,
                premiumPlanDetailText(plan),
                premiumPlanDetailKeyboard(plan, "offer"),
              );
              await answerCallbackQueryWithToken(token, callback.id, "Enviei o plano no privado.");
            } catch (error) {
              recordImageBotTelegramError({
                action: "group-automation-premium-plan",
                chatId,
                telegramUserId,
                error,
              });
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Abra o bot no privado e envie /start primeiro.",
                true,
              );
            }
            return Response.json({ ok: true, automationPremiumPlan: true });
          }

          if (callbackData === "ifull:noop") {
            if (hasLifetimeImageBotPremiumAccess(telegramUserId)) {
              const inlineKeyboard = callback.message?.reply_markup?.inline_keyboard;
              if (Array.isArray(inlineKeyboard)) {
                const nextKeyboard = inlineKeyboard
                  .map((row: InlineKeyboard[number]) =>
                    row.filter((button) => button.callback_data !== "ifull:noop"),
                  )
                  .filter((row: InlineKeyboard[number]) => row.length > 0);
                await editMessageReplyMarkupWithToken(token, chatId, messageId, nextKeyboard);
              }
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Voce ja possui acesso vitalicio.",
                true,
              );
              return Response.json({ ok: true, lifetimePremium: true });
            }
            await answerCallbackQueryWithToken(token, callback.id, "Abrindo planos...");
            await sendPremiumRequiredMessage({
              token,
              chatId,
              telegramUserId,
              context: "offer",
              intro: "Libere acesso total ao bot escolhendo um plano Premium.",
            });
            return Response.json({ ok: true, premiumMenuOpened: true });
          }

          const premiumMenuBack = callbackData.match(/^ipremium:menu(?::(limit|offer|favorite))?$/);
          if (premiumMenuBack) {
            const context = (premiumMenuBack[1] ?? "offer") as PremiumMenuContext;
            await answerCallbackQueryWithToken(token, callback.id, "Planos Premium");
            await sendPremiumRequiredMessage({
              token,
              chatId,
              telegramUserId,
              messageId,
              context,
              intro:
                context === "limit"
                  ? renderImageBotText(settings.daily_limit_message)
                  : context === "favorite"
                    ? "Favoritos sao um recurso Premium. Escolha um plano ativo abaixo."
                    : "Libere acesso total ao bot escolhendo um plano Premium.",
              reuseOnly: true,
            });
            return Response.json({ ok: true, premiumMenuBack: true });
          }

          const premiumPlanOpen = callbackData.match(
            /^ipremium:plan(?::(limit|offer|favorite))?:([0-9a-f-]{36})$/i,
          );
          if (premiumPlanOpen) {
            const context = (premiumPlanOpen[1] ?? "offer") as PremiumMenuContext;
            const plan = getImageBotPremiumPlan(premiumPlanOpen[2]);
            if (!plan?.is_active || Number(plan.price) <= 0) {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Este plano nao esta ativo.",
                true,
              );
              return Response.json({ ok: true, premiumPlanInactive: true });
            }
            await answerCallbackQueryWithToken(token, callback.id, plan.name);
            await editPremiumPlanDetail({ token, chatId, messageId, plan, context });
            return Response.json({ ok: true, premiumPlanOpened: true });
          }

          if (callbackData === "ifull:noop:legacy") {
            await answerCallbackQueryWithToken(
              token,
              callback.id,
              "Essa opção ainda não está ativa.",
            );
            return Response.json({ ok: true, fullAccessNoop: true });
          }

          const premiumBuy = callbackData.match(/^ipremium:buy:([0-9a-f-]{36})$/i);
          if (premiumBuy) {
            if (
              !allowImageBotInteraction({
                telegramUserId,
                action: `buy-premium:${premiumBuy[1]}`,
                cooldownMs: 10_000,
              })
            ) {
              await answerCallbackQueryWithToken(token, callback.id, "Aguarde um instante.");
              return Response.json({ ok: true, premiumBuyRateLimited: true });
            }
            await answerCallbackQueryWithToken(token, callback.id, "Gerando Pix...");
            try {
              const payment = await createImageBotPremiumPixOrder({
                telegramUserId,
                planId: premiumBuy[1],
                payerName: [callback.from?.first_name, callback.from?.last_name]
                  .filter(Boolean)
                  .join(" "),
              });
              await sendImageBotPremiumPixOrder({
                token,
                chatId,
                order: payment.order,
                messageId,
              });
              setImageBotPremiumMessageId(telegramUserId, null);
            } catch (error) {
              recordImageBotTelegramError({
                action: "image-premium-payment-create",
                chatId,
                telegramUserId,
                error,
              });
              await sendMessageWithToken(
                token,
                chatId,
                "Nao consegui gerar o Pix Premium agora. Tente novamente em alguns minutos.",
              );
              return Response.json({ ok: true, premiumPaymentCreateError: true });
            }
            return Response.json({ ok: true, premiumPaymentCreated: true });
          }

          if (callbackData.startsWith("ipremium_qr:")) {
            await answerCallbackQueryWithToken(token, callback.id, "Abrindo QR Code...");
            try {
              await sendImageBotPremiumPixQrCode({
                token,
                chatId,
                telegramUserId,
                orderId: callbackData.slice("ipremium_qr:".length),
              });
            } catch (error) {
              recordImageBotTelegramError({
                action: "image-premium-pix-qr",
                chatId,
                telegramUserId,
                error,
              });
              await sendMessageWithToken(
                token,
                chatId,
                "Nao consegui abrir o QR Code agora. Use o Pix copia e cola enviado acima.",
              );
            }
            return Response.json({ ok: true, imagePremiumPixQr: true });
          }

          if (callbackData === "ilimit:buy") {
            if (
              !allowImageBotInteraction({
                telegramUserId,
                action: "legacy-limit-offer",
                cooldownMs: 3_000,
              })
            ) {
              await answerCallbackQueryWithToken(token, callback.id, "Aguarde um instante.");
              return Response.json({ ok: true, legacyLimitRateLimited: true });
            }
            await answerCallbackQueryWithToken(token, callback.id, "Abrindo planos Premium...");
            await sendPremiumRequiredMessage({
              token,
              chatId,
              telegramUserId,
              context: "limit",
              intro: renderImageBotText(settings.daily_limit_message),
            });
            return Response.json({ ok: true, legacyLimitRedirected: true });
          }

          if (callbackData.startsWith("ilimit_qr:")) {
            await answerCallbackQueryWithToken(token, callback.id, "Abrindo QR Code...");
            try {
              await sendImageBotLimitBoostPixQrCode({
                token,
                chatId,
                telegramUserId,
                orderId: callbackData.slice("ilimit_qr:".length),
              });
            } catch (error) {
              recordImageBotTelegramError({
                action: "image-limit-pix-qr",
                chatId,
                telegramUserId,
                error,
              });
              await sendMessageWithToken(
                token,
                chatId,
                "Nao consegui abrir o QR Code agora. Use o Pix copia e cola enviado acima.",
              );
            }
            return Response.json({ ok: true, imageLimitPixQr: true });
          }

          if (callbackData.startsWith("ipix_qr:")) {
            await answerCallbackQueryWithToken(token, callback.id, "Abrindo QR Code...");
            try {
              await sendImageBotPixQrCode({
                token,
                chatId,
                telegramUserId,
                orderId: callbackData.slice("ipix_qr:".length),
              });
            } catch (error) {
              recordImageBotTelegramError({
                action: "image-pix-qr",
                chatId,
                telegramUserId,
                error,
              });
              await sendMessageWithToken(
                token,
                chatId,
                "Nao consegui abrir o QR Code agora. Use o Pix copia e cola enviado acima.",
              );
            }
            return Response.json({ ok: true, imagePixQr: true });
          }

          if (callbackData.startsWith("iadm:")) {
            await answerCallbackQueryWithToken(
              token,
              callback.id,
              "A administracao agora esta disponivel somente no painel web.",
              true,
            );
            await editMessageReplyMarkupWithToken(token, chatId, messageId, []).catch(
              () => undefined,
            );
            return Response.json({ ok: true, adminMovedToWebPanel: true });
          }

          if (callbackData.startsWith("iadm:")) {
            if (!callbackUserIsAdmin) {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Somente administradores podem usar este painel.",
                true,
              );
              return Response.json({ ok: true, adminForbidden: true });
            }

            const actionName = callbackData.slice("iadm:".length);
            if (!isAdminPanelAction(actionName)) {
              await answerCallbackQueryWithToken(token, callback.id, "Acao desconhecida.");
              return Response.json({ ok: true, adminUnknownAction: actionName });
            }

            const action = actionName;
            const requiredPermission = requiredAdminPermission(action);
            if (
              requiredPermission &&
              !hasAdminPermission(callbackAdminPermissions, requiredPermission)
            ) {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Voce nao possui permissao para esta acao.",
                true,
              );
              return Response.json({
                ok: true,
                adminPermissionDenied: requiredPermission,
              });
            }

            if (action === "noop") {
              await answerCallbackQueryWithToken(token, callback.id);
              return Response.json({ ok: true, adminNoop: true });
            }

            if (action === "close") {
              await answerCallbackQueryWithToken(token, callback.id);
              await editMessageTextWithToken(
                token,
                chatId,
                messageId,
                "Painel admin fechado. Use o botao Admin no menu fixo para abrir novamente.",
                [],
              );
              return Response.json({ ok: true, adminClosed: true });
            }

            let nextSettings = getImageBotSettings();

            if (action === "toggle_maintenance") {
              await answerCallbackQueryWithToken(token, callback.id, "Alternando manutencao...");
              updateImageBotSettings({
                id: nextSettings.id,
                maintenance_enabled: !nextSettings.maintenance_enabled,
              });
              nextSettings = getImageBotSettings();
              await editAdminPanelMessage({
                token,
                chatId,
                messageId,
                page: "system",
                settings: nextSettings,
              });
              return Response.json({ ok: true, adminPanel: "system" });
            }

            if (action === "toggle_auto_message") {
              await answerCallbackQueryWithToken(token, callback.id, "Alternando automsg...");
              updateImageBotSettings({
                id: nextSettings.id,
                auto_message_enabled: !nextSettings.auto_message_enabled,
              });
              nextSettings = getImageBotSettings();
              await editAdminPanelMessage({
                token,
                chatId,
                messageId,
                page: "system_messages",
                settings: nextSettings,
              });
              return Response.json({ ok: true, adminPanel: "system_messages" });
            }

            if (action === "media_test_hetero" || action === "media_test_trans") {
              const category = action === "media_test_hetero" ? "hetero" : "trans";
              await answerCallbackQueryWithToken(token, callback.id, "Enviando teste...");
              try {
                const result = await sendAdminRandomTestMedia({
                  token,
                  chatId,
                  telegramUserId,
                  category,
                  isAdmin: callbackUserIsAdmin,
                });
                return Response.json({ ok: true, adminMediaTest: category, result: result.status });
              } catch (error) {
                recordImageBotTelegramError({
                  action: "admin-media-test",
                  chatId,
                  telegramUserId,
                  error,
                });
                await sendMessageWithToken(token, chatId, "Falhei ao enviar a midia de teste.");
                return Response.json({ ok: true, adminMediaTestError: true });
              }
            }

            if (action === "send_latest_media") {
              if (
                !allowImageBotInteraction({
                  telegramUserId,
                  action: "admin-send-latest-media",
                  cooldownMs: 2_000,
                })
              ) {
                await answerCallbackQueryWithToken(token, callback.id, "Aguarde um instante.");
                return Response.json({ ok: true, adminLatestMediaRateLimited: true });
              }
              await answerCallbackQueryWithToken(token, callback.id, "Enviando ultima midia...");
              try {
                const result = await sendAdminLatestMedia({
                  token,
                  chatId,
                  telegramUserId,
                  isAdmin: callbackUserIsAdmin,
                });
                return Response.json({
                  ok: true,
                  adminLatestMedia: result.status,
                  mediaId: "mediaId" in result ? result.mediaId : null,
                });
              } catch (error) {
                recordImageBotTelegramError({
                  action: "admin-send-latest-media",
                  chatId,
                  telegramUserId,
                  error,
                });
                await sendMessageWithToken(token, chatId, "Falhei ao enviar a ultima midia.");
                return Response.json({ ok: true, adminLatestMediaError: true });
              }
            }

            if (action === "delete_last_ask") {
              await answerCallbackQueryWithToken(token, callback.id);
              const latest = getLatestActiveImageBotMedia();
              await editMessageTextWithToken(
                token,
                chatId,
                messageId,
                latest
                  ? [
                      "<b>Confirmar exclusao</b>",
                      "",
                      "Vou mover a ultima midia ativa para a lixeira.",
                      formatAdminMediaLine(latest, 0),
                    ].join("\n")
                  : "Nao existe midia ativa para excluir.",
                latest
                  ? adminConfirmKeyboard("delete_last")
                  : adminPanelKeyboard("media", nextSettings),
              );
              return Response.json({ ok: true, adminDeleteLastAsk: Boolean(latest) });
            }

            if (action === "delete_last_no") {
              await answerCallbackQueryWithToken(token, callback.id, "Cancelado.");
              await editAdminPanelMessage({
                token,
                chatId,
                messageId,
                page: "media",
                settings: nextSettings,
              });
              return Response.json({ ok: true, adminDeleteLastCanceled: true });
            }

            if (action === "delete_last_yes") {
              await answerCallbackQueryWithToken(token, callback.id, "Movendo para lixeira...");
              const latest = getLatestActiveImageBotMedia();
              if (latest) deleteImageBotMedia(latest.id, `telegram:${telegramUserId}`);
              await editAdminPanelMessage({
                token,
                chatId,
                messageId,
                page: "media_trash",
                settings: nextSettings,
              });
              return Response.json({ ok: true, adminDeleteLast: Boolean(latest) });
            }

            if (action === "restore_last_ask") {
              await answerCallbackQueryWithToken(token, callback.id);
              const latestDeleted = getImageBotDeletedMedia()[0];
              await editMessageTextWithToken(
                token,
                chatId,
                messageId,
                latestDeleted
                  ? [
                      "<b>Confirmar restauracao</b>",
                      "",
                      "Vou restaurar a ultima midia da lixeira.",
                      `${latestDeleted.category}/${latestDeleted.media_type} - ${formatShortDate(latestDeleted.deleted_at)}`,
                    ].join("\n")
                  : "A lixeira esta vazia.",
                latestDeleted
                  ? adminConfirmKeyboard("restore_last")
                  : adminPanelKeyboard("media_trash", nextSettings),
              );
              return Response.json({ ok: true, adminRestoreLastAsk: Boolean(latestDeleted) });
            }

            if (action === "restore_last_no") {
              await answerCallbackQueryWithToken(token, callback.id, "Cancelado.");
              await editAdminPanelMessage({
                token,
                chatId,
                messageId,
                page: "media_trash",
                settings: nextSettings,
              });
              return Response.json({ ok: true, adminRestoreLastCanceled: true });
            }

            if (action === "restore_last_yes") {
              await answerCallbackQueryWithToken(token, callback.id, "Restaurando...");
              const latestDeleted = getImageBotDeletedMedia()[0];
              if (latestDeleted)
                restoreImageBotMedia(latestDeleted.id, `telegram:${telegramUserId}`);
              await editAdminPanelMessage({
                token,
                chatId,
                messageId,
                page: "media_trash",
                settings: nextSettings,
              });
              return Response.json({ ok: true, adminRestoreLast: Boolean(latestDeleted) });
            }

            if (isAdminPanelPage(action)) {
              await answerCallbackQueryWithToken(token, callback.id);
              await editAdminPanelMessage({
                token,
                chatId,
                messageId,
                page: action,
                settings: nextSettings,
              });
              return Response.json({ ok: true, adminPanel: action });
            }

            await answerCallbackQueryWithToken(token, callback.id);
            return Response.json({ ok: true, adminActionUnhandled: action });
          }

          if (callbackData === "fnav:count") {
            await answerCallbackQueryWithToken(token, callback.id);
            return Response.json({ ok: true, favoriteCounter: true });
          }

          if (callbackData.startsWith("iunfav:")) {
            const mediaId = callbackData.slice("iunfav:".length);
            if (
              !allowImageBotInteraction({
                telegramUserId,
                action: `unfavorite:${mediaId}`,
                cooldownMs: 1_000,
              })
            ) {
              await answerCallbackQueryWithToken(token, callback.id, "Aguarde um instante.");
              return Response.json({ ok: true, unfavoriteRateLimited: true });
            }

            const removed = removeImageBotFavorite(telegramUserId, mediaId);
            await editMessageReplyMarkupWithToken(
              token,
              chatId,
              messageId,
              mediaActions(mediaId, false, callbackUserIsAdmin, telegramUserId),
            );
            await answerCallbackQueryWithToken(
              token,
              callback.id,
              removed.status === "removed"
                ? "Removido dos favoritos."
                : "Esta mídia não estava nos favoritos.",
            );
            return Response.json({ ok: true, unfavorite: removed.status });
          }

          const favoriteRemoval = callbackData.match(/^frem:(ask|yes|no):([0-9a-f-]{36})$/i);
          if (favoriteRemoval) {
            const action = favoriteRemoval[1] as "ask" | "yes" | "no";
            const mediaId = favoriteRemoval[2];
            const currentPage = getImageBotFavoritePage({
              telegramUserId,
              currentMediaId: mediaId,
            });
            if (currentPage.status === "empty") {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Esta mídia não está mais nos seus favoritos.",
                true,
              );
              return Response.json({ ok: true, favoriteRemovalMissing: true });
            }

            if (action === "ask") {
              await editMessageReplyMarkupWithToken(
                token,
                chatId,
                messageId,
                favoriteRemovalConfirmation(mediaId),
              );
              await answerCallbackQueryWithToken(token, callback.id);
              return Response.json({ ok: true, favoriteRemovalConfirmation: true });
            }

            if (action === "no") {
              await editMessageReplyMarkupWithToken(
                token,
                chatId,
                messageId,
                favoriteNavigation(
                  currentPage.media.id,
                  currentPage.index,
                  currentPage.total,
                  callbackUserIsAdmin,
                  telegramUserId,
                ),
              );
              await answerCallbackQueryWithToken(token, callback.id, "Remoção cancelada.");
              return Response.json({ ok: true, favoriteRemovalCancelled: true });
            }

            if (
              !allowImageBotInteraction({
                telegramUserId,
                action: `remove-favorite:${mediaId}`,
                cooldownMs: 1_000,
              })
            ) {
              await answerCallbackQueryWithToken(token, callback.id, "Aguarde um instante.");
              return Response.json({ ok: true, favoriteRemovalRateLimited: true });
            }

            removeImageBotFavorite(telegramUserId, mediaId);
            const nextPage = getImageBotFavoritePage({
              telegramUserId,
              category: currentPage.media.category,
            });
            if (nextPage.status === "empty") {
              await answerCallbackQueryWithToken(token, callback.id, "Favorito removido.");
              try {
                await deleteMessageWithToken(token, chatId, messageId);
              } catch (error) {
                console.warn("[image-bot-remove-last-favorite-message]", error);
                await editMessageReplyMarkupWithToken(token, chatId, messageId, []);
              }
              return Response.json({ ok: true, lastFavoriteRemoved: true });
            }

            await editMessageMediaWithToken(
              token,
              chatId,
              messageId,
              { type: nextPage.media.media_type, media: nextPage.media.file_id },
              favoriteNavigation(
                nextPage.media.id,
                nextPage.index,
                nextPage.total,
                callbackUserIsAdmin,
                telegramUserId,
              ),
            );
            recordImageBotMediaDelivery({
              telegramUserId,
              media: nextPage.media,
              source: "favorite",
            });
            await answerCallbackQueryWithToken(token, callback.id, "Favorito removido.");
            return Response.json({ ok: true, favoriteRemoved: true });
          }

          const deleteAction = callbackData.match(/^idel:(ask|yes|no):([rvf]):([0-9a-f-]{36})$/i);
          if (deleteAction) {
            const [, action, context, mediaId] = deleteAction as RegExpMatchArray & {
              1: "ask" | "yes" | "no";
              2: "r" | "v" | "f";
            };
            if (
              !callbackUserIsAdmin ||
              !hasAdminPermission(callbackAdminPermissions, "can_delete_media")
            ) {
              if (context === "f") {
                const page = getImageBotFavoritePage({
                  telegramUserId,
                  currentMediaId: mediaId,
                });
                if (page.status === "ok") {
                  await editMessageReplyMarkupWithToken(
                    token,
                    chatId,
                    messageId,
                    favoriteNavigation(
                      page.media.id,
                      page.index,
                      page.total,
                      false,
                      telegramUserId,
                    ),
                  );
                }
              } else {
                await editMessageReplyMarkupWithToken(
                  token,
                  chatId,
                  messageId,
                  mediaActions(mediaId, context === "v", false, telegramUserId),
                );
              }
              await answerCallbackQueryWithToken(token, callback.id);
              return Response.json({ ok: true, deleteForbidden: true });
            }

            if (action === "ask") {
              await editMessageReplyMarkupWithToken(
                token,
                chatId,
                messageId,
                deleteConfirmation(mediaId, context),
              );
              await answerCallbackQueryWithToken(token, callback.id);
              return Response.json({ ok: true, deleteConfirmation: true });
            }

            if (action === "no") {
              if (context === "f") {
                const page = getImageBotFavoritePage({
                  telegramUserId,
                  currentMediaId: mediaId,
                });
                if (page.status === "empty") {
                  await answerCallbackQueryWithToken(
                    token,
                    callback.id,
                    "Esta mídia não está mais disponível.",
                    true,
                  );
                  return Response.json({ ok: true, deleteCancelMissing: true });
                }
                await editMessageReplyMarkupWithToken(
                  token,
                  chatId,
                  messageId,
                  favoriteNavigation(
                    page.media.id,
                    page.index,
                    page.total,
                    callbackUserIsAdmin,
                    telegramUserId,
                  ),
                );
              } else {
                await editMessageReplyMarkupWithToken(
                  token,
                  chatId,
                  messageId,
                  mediaActions(mediaId, context === "v", callbackUserIsAdmin, telegramUserId),
                );
              }
              await answerCallbackQueryWithToken(token, callback.id, "Exclusão cancelada.");
              return Response.json({ ok: true, deleteCancelled: true });
            }

            if (
              !allowImageBotInteraction({
                telegramUserId,
                action: `delete-media:${mediaId}`,
                cooldownMs: 2_000,
              })
            ) {
              await answerCallbackQueryWithToken(token, callback.id, "Aguarde um instante.");
              return Response.json({ ok: true, deleteRateLimited: true });
            }

            const deleted = deleteImageBotMedia(mediaId, `telegram:${telegramUserId}`);
            await answerCallbackQueryWithToken(
              token,
              callback.id,
              deleted ? "Mídia excluída permanentemente." : "Esta mídia já foi excluída.",
              !deleted,
            );
            try {
              await deleteMessageWithToken(token, chatId, messageId);
            } catch (error) {
              console.warn("[image-bot-delete-message]", error);
              await editMessageReplyMarkupWithToken(token, chatId, messageId, []);
            }
            return Response.json({ ok: true, mediaDeleted: deleted });
          }

          if (callbackData.startsWith("ifav:")) {
            const mediaId = callbackData.slice("ifav:".length);
            const media = getImageBotMediaById(mediaId);
            if (!media) {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Esta midia nao esta mais disponivel.",
                true,
              );
              return Response.json({ ok: true, favorite: "not_found" });
            }
            if (!callbackUserIsAdmin && !hasImageBotFavoriteAccess(telegramUserId)) {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Favoritos e exclusivo para usuarios Premium.",
                true,
              );
              if (
                allowImageBotInteraction({
                  telegramUserId,
                  action: "premium-favorite-offer",
                  cooldownMs: 5_000,
                })
              ) {
                await sendPremiumRequiredMessage({
                  token,
                  chatId,
                  telegramUserId,
                  context: "favorite",
                });
              }
              return Response.json({ ok: true, premiumRequired: true });
            }
            if (
              !allowImageBotInteraction({
                telegramUserId,
                action: `favorite:${mediaId}`,
                cooldownMs: 1_000,
              })
            ) {
              await answerCallbackQueryWithToken(token, callback.id, "Aguarde um instante.");
              return Response.json({ ok: true, favoriteRateLimited: true });
            }

            const favorite = favoriteImageBotMedia(telegramUserId, media.id);
            if (favorite.status === "not_found") {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Esta mídia não está mais disponível.",
                true,
              );
              return Response.json({ ok: true, favorite: favorite.status });
            }

            await editMessageReplyMarkupWithToken(
              token,
              chatId,
              messageId,
              mediaActions(mediaId, true, callbackUserIsAdmin, telegramUserId),
            );
            await answerCallbackQueryWithToken(
              token,
              callback.id,
              favorite.status === "favorited"
                ? "Adicionado aos favoritos."
                : "Já estava nos favoritos.",
            );
            return Response.json({ ok: true, favorite: favorite.status });
          }

          const navigation = callbackData.match(/^fnav:([pn]):([0-9a-f-]{36})$/i);
          if (navigation) {
            if (!callbackUserIsAdmin && !hasImageBotFavoriteAccess(telegramUserId)) {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Seus favoritos exigem Premium ativo.",
                true,
              );
              if (
                allowImageBotInteraction({
                  telegramUserId,
                  action: "premium-navigation-offer",
                  cooldownMs: 5_000,
                })
              ) {
                await sendPremiumRequiredMessage({
                  token,
                  chatId,
                  telegramUserId,
                  context: "favorite",
                });
              }
              return Response.json({ ok: true, premiumRequired: true });
            }
            if (
              !allowImageBotInteraction({
                telegramUserId,
                action: "favorite-navigation",
                cooldownMs: 750,
              })
            ) {
              await answerCallbackQueryWithToken(token, callback.id, "Aguarde um instante.");
              return Response.json({ ok: true, navigationRateLimited: true });
            }

            const page = getImageBotFavoritePage({
              telegramUserId,
              currentMediaId: navigation[2],
              direction: navigation[1] === "p" ? "previous" : "next",
            });
            if (page.status === "empty") {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Esta mídia não está mais disponível.",
                true,
              );
              return Response.json({ ok: true, favoriteEmpty: true });
            }

            if (page.total === 1 || page.media.id === navigation[2]) {
              await answerCallbackQueryWithToken(
                token,
                callback.id,
                "Você tem apenas 1 favorito nesta categoria.",
              );
              return Response.json({ ok: true, onlyOneFavorite: true });
            }

            await editMessageMediaWithToken(
              token,
              chatId,
              messageId,
              { type: page.media.media_type, media: page.media.file_id },
              favoriteNavigation(
                page.media.id,
                page.index,
                page.total,
                callbackUserIsAdmin,
                telegramUserId,
              ),
            );
            recordImageBotMediaDelivery({
              telegramUserId,
              media: page.media,
              source: "favorite",
            });
            await answerCallbackQueryWithToken(token, callback.id);
            return Response.json({ ok: true, favoriteNavigated: true });
          }

          await answerCallbackQueryWithToken(token, callback.id, "Use o menu fixo abaixo.");
          return Response.json({ ok: true, legacyCallbackIgnored: true });
        }

        const message = update.message;
        if (!message?.chat?.id) return Response.json({ ok: true, ignored: true });

        if (message.migrate_to_chat_id) {
          migrateImageBotGroupChatId(Number(message.chat.id), Number(message.migrate_to_chat_id));
          return Response.json({ ok: true, groupMigrated: true });
        }

        if (isGroupChat(message.chat)) {
          await syncGroup(message.chat, { isActive: true });
          const category = categoryFromGroupTitle(message.chat.title ?? "");
          const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null;
          const video = message.video ?? null;
          const document = message.document ?? null;
          const documentType = String(document?.mime_type ?? "").startsWith("image/")
            ? "photo"
            : String(document?.mime_type ?? "").startsWith("video/")
              ? "video"
              : null;
          const media = video ?? photo ?? (documentType ? document : null);
          const mediaType = video ? "video" : photo ? "photo" : documentType;
          if (category && media && mediaType) {
            const result = saveImageBotMedia({
              telegramChatId: Number(message.chat.id),
              telegramMessageId: Number(message.message_id),
              category,
              mediaType,
              fileId: String(media.file_id),
              fileUniqueId: String(media.file_unique_id),
              mediaGroupId: message.media_group_id ? String(message.media_group_id) : null,
              caption: message.caption ?? null,
            });
            return Response.json({
              ok: true,
              mediaSaved: result.saved,
              category,
              mediaType,
            });
          }
          return Response.json({ ok: true, groupActivity: true });
        }

        const chatId = Number(message.chat.id);
        const telegramUserId = Number(message.from?.id ?? chatId);
        const text = String(message.text ?? "").trim();
        upsertImageBotUser({
          telegramUserId,
          username: message.from?.username ?? null,
          firstName: message.from?.first_name ?? null,
          lastName: message.from?.last_name ?? null,
          languageCode: message.from?.language_code ?? null,
          isBot: Boolean(message.from?.is_bot),
          isTelegramPremium: Boolean(message.from?.is_premium),
          telegramProfile: message.from ?? null,
          started: text.startsWith("/start"),
        });
        const messageUserIsAdmin = isImageBotUserAdmin(telegramUserId);
        if (isImageBotUserBlocked(telegramUserId) && !messageUserIsAdmin) {
          if (
            allowImageBotInteraction({
              telegramUserId,
              action: "blocked-message",
              cooldownMs: 30_000,
            })
          ) {
            await sendMessageWithToken(token, chatId, "Seu acesso ao bot está bloqueado.");
          }
          return Response.json({ ok: true, userBlocked: true });
        }
        const messageAvailability = getAvailability(settings);
        if (messageAvailability.status !== "open" && !messageUserIsAdmin) {
          if (
            allowImageBotInteraction({
              telegramUserId,
              action: `availability:${messageAvailability.status}`,
              cooldownMs: 30_000,
            })
          ) {
            await sendMessageWithToken(token, chatId, messageAvailability.message);
          }
          return Response.json({ ok: true, botUnavailable: messageAvailability.status });
        }
        const legacyAdminRequest =
          /^\/(?:admin|usuario|bloquear|desbloquear|msg|adminadd|adminrem|teste)(?:@\w+)?(?:\s|$)/i.test(
            text,
          ) || matchesButton(text, adminLabels.open, legacyAdminLabels.open);
        if (legacyAdminRequest) {
          await sendMessageWithTokenReplyKeyboard(
            token,
            chatId,
            "A administracao do UpMidias agora esta disponivel somente no painel web.",
            imageCategoryMenu(settings),
          );
          return Response.json({ ok: true, adminMovedToWebPanel: true });
        }
        const selectedCategory = selectedCategoryFromText(text, settings);
        if (selectedCategory) {
          const category = selectedCategory;
          if (
            !allowImageBotInteraction({
              telegramUserId,
              action: `category:${category}`,
              cooldownMs: 3_000,
            })
          ) {
            return Response.json({ ok: true, menuRateLimited: true });
          }
          setImageBotUserCategory(telegramUserId, category);
          await sendMessageWithTokenReplyKeyboard(
            token,
            chatId,
            renderImageBotText(settings.media_prompt, {
              categoria: imageCategoryLabel(settings, category),
            }),
            imageMediaMenu(settings, messageUserIsAdmin, telegramUserId),
          );
          return Response.json({ ok: true, category });
        }

        if (matchesButton(text, settings.back_button_label, legacyMediaLabels.back)) {
          setImageBotUserCategory(telegramUserId, null);
          await sendMessageWithTokenReplyKeyboard(
            token,
            chatId,
            settings.category_prompt,
            imageCategoryMenu(settings, messageUserIsAdmin),
          );
          return Response.json({ ok: true, returnedToCategories: true });
        }

        if (
          matchesButton(text, settings.premium_offer_button_label, ["Libere acesso total ao bot"])
        ) {
          if (hasLifetimeImageBotPremiumAccess(telegramUserId)) {
            await sendMessageWithTokenReplyKeyboard(
              token,
              chatId,
              "Voce ja possui acesso vitalicio.",
              imageMediaMenu(settings, messageUserIsAdmin, telegramUserId),
            );
            return Response.json({ ok: true, lifetimePremium: true });
          }
          if (
            !allowImageBotInteraction({
              telegramUserId,
              action: "open-premium-menu",
              cooldownMs: 2_000,
            })
          ) {
            return Response.json({ ok: true, premiumMenuRateLimited: true });
          }
          await sendPremiumRequiredMessage({
            token,
            chatId,
            telegramUserId,
            context: "offer",
            forceNew: true,
          });
          return Response.json({ ok: true, premiumMenuOpened: true });
        }

        const deliveryType = matchesButton(text, settings.random_button_label, [
          settings.photo_button_label,
          settings.video_button_label,
          ...legacyMediaLabels.random,
          ...legacyMediaLabels.photo,
          ...legacyMediaLabels.video,
        ])
          ? "random"
          : null;
        if (deliveryType) {
          const category = getImageBotUserCategory(telegramUserId);
          if (!category) {
            await sendMessageWithTokenReplyKeyboard(
              token,
              chatId,
              settings.category_required_message,
              imageCategoryMenu(settings, messageUserIsAdmin),
            );
            return Response.json({ ok: true, categoryRequired: true });
          }

          const delivery = claimImageBotMedia({
            telegramUserId,
            category,
            deliveryType,
          });
          if (delivery.status === "rate_limited") {
            if (
              allowImageBotInteraction({
                telegramUserId,
                action: "limit-message",
                cooldownMs: 5_000,
              })
            ) {
              await sendMessageWithTokenReplyKeyboard(
                token,
                chatId,
                renderImageBotText(settings.rate_limit_message, {
                  retry_after: delivery.retryAfterSeconds,
                }),
                imageMediaMenu(settings, messageUserIsAdmin, telegramUserId),
              );
            }
            return Response.json({ ok: true, rateLimited: true });
          }
          if (delivery.status === "daily_limited") {
            if (
              allowImageBotInteraction({
                telegramUserId,
                action: "daily-limit-message",
                cooldownMs: 30_000,
              })
            ) {
              await sendPremiumRequiredMessage({
                token,
                chatId,
                telegramUserId,
                context: "limit",
                forceNew: true,
                intro: renderImageBotText(settings.daily_limit_message, {
                  retry_after: delivery.retryAfterSeconds,
                }),
              });
            }
            return Response.json({ ok: true, dailyLimited: true });
          }
          if (delivery.status === "blocked") {
            return Response.json({ ok: true, userBlocked: true });
          }
          if (delivery.status === "empty") {
            await sendMessageWithTokenReplyKeyboard(
              token,
              chatId,
              settings.empty_media_message,
              imageMediaMenu(settings, messageUserIsAdmin, telegramUserId),
            );
            return Response.json({ ok: true, empty: true });
          }

          try {
            if (delivery.media.media_type === "photo") {
              await sendPhotoWithToken(
                token,
                chatId,
                delivery.media.file_id,
                "",
                mediaActions(delivery.media.id, false, messageUserIsAdmin, telegramUserId),
              );
            } else {
              await sendVideoWithToken(
                token,
                chatId,
                delivery.media.file_id,
                "",
                mediaActions(delivery.media.id, false, messageUserIsAdmin, telegramUserId),
              );
            }
          } catch (error) {
            recordImageBotTelegramError({
              action: "deliver-media",
              chatId,
              telegramUserId,
              error,
            });
            await sendMessageWithTokenReplyKeyboard(
              token,
              chatId,
              "Não consegui enviar esta mídia agora. Tente outra.",
              imageMediaMenu(settings, messageUserIsAdmin, telegramUserId),
            );
            return Response.json({ ok: true, telegramDeliveryError: true });
          }
          await sendAutoMessageAfterDelivery({
            token,
            chatId,
            telegramUserId,
            settings,
            deliveredCount: delivery.deliveredCount,
            isAdmin: messageUserIsAdmin,
          });
          return Response.json({ ok: true, mediaDelivered: true });
        }

        if (matchesButton(text, settings.favorites_button_label, legacyMediaLabels.favorites)) {
          const category = getImageBotUserCategory(telegramUserId);
          if (!category) {
            await sendMessageWithTokenReplyKeyboard(
              token,
              chatId,
              settings.category_required_message,
              imageCategoryMenu(settings, messageUserIsAdmin),
            );
            return Response.json({ ok: true, categoryRequired: true });
          }
          if (!messageUserIsAdmin && !hasImageBotFavoriteAccess(telegramUserId)) {
            if (
              allowImageBotInteraction({
                telegramUserId,
                action: "premium-favorites-offer",
                cooldownMs: 5_000,
              })
            ) {
              await sendPremiumRequiredMessage({
                token,
                chatId,
                telegramUserId,
                context: "favorite",
                forceNew: true,
              });
            }
            return Response.json({ ok: true, premiumRequired: true });
          }
          if (
            !allowImageBotInteraction({
              telegramUserId,
              action: "open-favorites",
              cooldownMs: 3_000,
            })
          ) {
            return Response.json({ ok: true, favoritesRateLimited: true });
          }

          const page = getImageBotFavoritePage({ telegramUserId, category });
          if (page.status === "empty") {
            await sendMessageWithTokenReplyKeyboard(
              token,
              chatId,
              settings.favorites_empty_message,
              imageMediaMenu(settings, messageUserIsAdmin, telegramUserId),
            );
            return Response.json({ ok: true, favoriteEmpty: true });
          }

          try {
            if (page.media.media_type === "photo") {
              await sendPhotoWithToken(
                token,
                chatId,
                page.media.file_id,
                "",
                favoriteNavigation(
                  page.media.id,
                  page.index,
                  page.total,
                  messageUserIsAdmin,
                  telegramUserId,
                ),
              );
            } else {
              await sendVideoWithToken(
                token,
                chatId,
                page.media.file_id,
                "",
                favoriteNavigation(
                  page.media.id,
                  page.index,
                  page.total,
                  messageUserIsAdmin,
                  telegramUserId,
                ),
              );
            }
          } catch (error) {
            recordImageBotTelegramError({
              action: "deliver-favorite",
              chatId,
              telegramUserId,
              error,
            });
            await sendMessageWithTokenReplyKeyboard(
              token,
              chatId,
              "Não consegui enviar este favorito agora.",
              imageMediaMenu(settings, messageUserIsAdmin, telegramUserId),
            );
            return Response.json({ ok: true, telegramFavoriteError: true });
          }
          recordImageBotMediaDelivery({
            telegramUserId,
            media: page.media,
            source: "favorite",
          });
          return Response.json({ ok: true, favoriteDelivered: true });
        }
        if (!text.startsWith("/start")) {
          if (
            !allowImageBotInteraction({
              telegramUserId,
              action: "category-menu",
              cooldownMs: 5_000,
            })
          ) {
            return Response.json({ ok: true, menuRateLimited: true });
          }
          await sendMessageWithTokenReplyKeyboard(
            token,
            chatId,
            settings.category_prompt,
            imageCategoryMenu(settings, messageUserIsAdmin),
          );
          return Response.json({ ok: true });
        }

        if (
          !allowImageBotInteraction({
            telegramUserId,
            action: "start",
            cooldownMs: 5_000,
          })
        ) {
          return Response.json({ ok: true, startRateLimited: true });
        }

        setImageBotUserCategory(telegramUserId, null);

        if (settings.welcome_image_url) {
          try {
            await sendPhotoWithTokenReplyKeyboard(
              token,
              chatId,
              settings.welcome_image_url,
              settings.welcome_message,
              imageCategoryMenu(settings, messageUserIsAdmin),
            );
          } catch (photoError) {
            console.error("[image-bot-welcome-photo]", photoError);
            recordImageBotTelegramError({
              action: "welcome-photo",
              chatId,
              telegramUserId,
              error: photoError,
            });
            await sendMessageWithTokenReplyKeyboard(
              token,
              chatId,
              settings.welcome_message,
              imageCategoryMenu(settings, messageUserIsAdmin),
            );
          }
        } else {
          await sendMessageWithTokenReplyKeyboard(
            token,
            chatId,
            settings.welcome_message,
            imageCategoryMenu(settings, messageUserIsAdmin),
          );
        }
        return Response.json({ ok: true });
      },
    },
  },
});
