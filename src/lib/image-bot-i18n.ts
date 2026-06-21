export type ImageBotLanguage = "pt" | "en" | "es";

type ImageBotTranslation = {
  languageButton: string;
  languagePrompt: string;
  languageChanged: string;
  categoryHetero: string;
  categoryTrans: string;
  mediaButton: string;
  favoritesButton: string;
  backButton: string;
  premiumButton: string;
  categoryPrompt: string;
  mediaPrompt: (category: string) => string;
  categoryRequired: string;
  emptyMedia: string;
  favoritesEmpty: string;
  rateLimit: (seconds: number) => string;
  dailyLimit: string;
  blocked: string;
  welcome: string;
  mediaError: string;
  favoriteError: string;
  premiumLifetime: string;
  adminMoved: string;
  favorite: string;
  unfavorite: string;
  removeFavorite: string;
  deleteMedia: string;
};

const translations: Record<ImageBotLanguage, ImageBotTranslation> = {
  pt: {
    languageButton: "🌐 Idioma",
    languagePrompt: "Escolha seu idioma:",
    languageChanged: "Idioma alterado para Português.",
    categoryHetero: "Hétero",
    categoryTrans: "Trans",
    mediaButton: "🎲 Mídias",
    favoritesButton: "❤️ Favoritos",
    backButton: "⬅️ Voltar",
    premiumButton: "Libere acesso total ao bot",
    categoryPrompt: "Escolha uma categoria:",
    mediaPrompt: (category) =>
      `<b>${category}</b> selecionado. Toque em Mídias para receber uma foto ou vídeo aleatório:`,
    categoryRequired: "Escolha uma categoria primeiro.",
    emptyMedia: "Ainda não há mídias disponíveis nesta categoria.",
    favoritesEmpty: "Você ainda não possui favoritos nesta categoria.",
    rateLimit: (seconds) => `Aguarde ${seconds}s antes de pedir outra mídia.`,
    dailyLimit: "Você atingiu seu limite diário de mídias.",
    blocked: "Seu acesso ao bot está bloqueado.",
    welcome: "Bem-vindo(a)! Escolha uma categoria abaixo.",
    mediaError: "Não consegui enviar esta mídia agora. Tente outra.",
    favoriteError: "Não consegui enviar este favorito agora.",
    premiumLifetime: "Você já possui acesso vitalício.",
    adminMoved: "A administração do UpMidias está disponível somente no painel web.",
    favorite: "⭐ Favoritar",
    unfavorite: "💔 Remover favorito",
    removeFavorite: "💔 Remover favorito",
    deleteMedia: "Excluir",
  },
  en: {
    languageButton: "🌐 Language",
    languagePrompt: "Choose your language:",
    languageChanged: "Language changed to English.",
    categoryHetero: "Straight",
    categoryTrans: "Trans",
    mediaButton: "🎲 Media",
    favoritesButton: "❤️ Favorites",
    backButton: "⬅️ Back",
    premiumButton: "Unlock full bot access",
    categoryPrompt: "Choose a category:",
    mediaPrompt: (category) =>
      `<b>${category}</b> selected. Tap Media to receive a random photo or video:`,
    categoryRequired: "Choose a category first.",
    emptyMedia: "There is no media available in this category yet.",
    favoritesEmpty: "You do not have favorites in this category yet.",
    rateLimit: (seconds) => `Wait ${seconds}s before requesting more media.`,
    dailyLimit: "You have reached your daily media limit.",
    blocked: "Your access to the bot is blocked.",
    welcome: "Welcome! Choose a category below.",
    mediaError: "I could not send this media right now. Try another one.",
    favoriteError: "I could not send this favorite right now.",
    premiumLifetime: "You already have lifetime access.",
    adminMoved: "UpMidias administration is available only in the web panel.",
    favorite: "⭐ Favorite",
    unfavorite: "💔 Remove favorite",
    removeFavorite: "💔 Remove favorite",
    deleteMedia: "Delete",
  },
  es: {
    languageButton: "🌐 Idioma",
    languagePrompt: "Elige tu idioma:",
    languageChanged: "Idioma cambiado a Español.",
    categoryHetero: "Hetero",
    categoryTrans: "Trans",
    mediaButton: "🎲 Medios",
    favoritesButton: "❤️ Favoritos",
    backButton: "⬅️ Volver",
    premiumButton: "Desbloquear acceso completo",
    categoryPrompt: "Elige una categoría:",
    mediaPrompt: (category) =>
      `<b>${category}</b> seleccionado. Toca Medios para recibir una foto o video aleatorio:`,
    categoryRequired: "Primero elige una categoría.",
    emptyMedia: "Todavía no hay medios disponibles en esta categoría.",
    favoritesEmpty: "Todavía no tienes favoritos en esta categoría.",
    rateLimit: (seconds) => `Espera ${seconds}s antes de solicitar más medios.`,
    dailyLimit: "Has alcanzado tu límite diario de medios.",
    blocked: "Tu acceso al bot está bloqueado.",
    welcome: "¡Bienvenido! Elige una categoría abajo.",
    mediaError: "No pude enviar este medio ahora. Prueba con otro.",
    favoriteError: "No pude enviar este favorito ahora.",
    premiumLifetime: "Ya tienes acceso vitalicio.",
    adminMoved: "La administración de UpMidias está disponible solo en el panel web.",
    favorite: "⭐ Favorito",
    unfavorite: "💔 Quitar favorito",
    removeFavorite: "💔 Quitar favorito",
    deleteMedia: "Eliminar",
  },
};

export function detectImageBotLanguage(value: string | null | undefined): ImageBotLanguage {
  const language = value?.trim().toLowerCase() ?? "";
  if (language.startsWith("en")) return "en";
  if (language.startsWith("es")) return "es";
  return "pt";
}

export function getImageBotTranslation(language: ImageBotLanguage) {
  return translations[language];
}

export function imageBotLanguageFromSelection(value: string): ImageBotLanguage | null {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (["português", "portugues", "🇧🇷 português", "🇧🇷 portugues"].includes(normalized)) {
    return "pt";
  }
  if (["english", "🇺🇸 english", "🇬🇧 english"].includes(normalized)) return "en";
  if (["español", "espanol", "🇪🇸 español", "🇪🇸 espanol"].includes(normalized)) return "es";
  return null;
}

export const imageBotLanguageChoices = {
  pt: "🇧🇷 Português",
  en: "🇺🇸 English",
  es: "🇪🇸 Español",
} satisfies Record<ImageBotLanguage, string>;
