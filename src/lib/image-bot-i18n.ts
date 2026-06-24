export const imageBotLanguages = ["pt", "en", "es", "ar", "ru", "th"] as const;

export type ImageBotLanguage = (typeof imageBotLanguages)[number];

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
    mediaButton: "🎬 Receba vídeos",
    favoritesButton: "❤️ Favoritos",
    backButton: "⬅️ Voltar",
    premiumButton: "Libere acesso total ao bot",
    categoryPrompt: "Escolha uma categoria:",
    mediaPrompt: (category) =>
      `<b>${category}</b> selecionado. Toque em Receba vídeos para receber uma mídia aleatória:`,
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
    mediaButton: "🎬 Get videos",
    favoritesButton: "❤️ Favorites",
    backButton: "⬅️ Back",
    premiumButton: "Unlock full bot access",
    categoryPrompt: "Choose a category:",
    mediaPrompt: (category) =>
      `<b>${category}</b> selected. Tap Get videos to receive random media:`,
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
    mediaButton: "🎬 Recibir videos",
    favoritesButton: "❤️ Favoritos",
    backButton: "⬅️ Volver",
    premiumButton: "Desbloquear acceso completo",
    categoryPrompt: "Elige una categoría:",
    mediaPrompt: (category) =>
      `<b>${category}</b> seleccionado. Toca Recibir videos para recibir un contenido aleatorio:`,
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
  ar: {
    languageButton: "🌐 اللغة",
    languagePrompt: "اختر لغتك:",
    languageChanged: "تم تغيير اللغة إلى العربية.",
    categoryHetero: "ستريت",
    categoryTrans: "ترانس",
    mediaButton: "🎬 استلام فيديوهات",
    favoritesButton: "❤️ المفضلة",
    backButton: "⬅️ رجوع",
    premiumButton: "افتح الوصول الكامل للبوت",
    categoryPrompt: "اختر فئة:",
    mediaPrompt: (category) =>
      `<b>${category}</b> تم اختياره. اضغط على استلام فيديوهات للحصول على محتوى عشوائي:`,
    categoryRequired: "اختر فئة أولاً.",
    emptyMedia: "لا يوجد محتوى متاح في هذه الفئة حالياً.",
    favoritesEmpty: "لا توجد عناصر مفضلة في هذه الفئة حتى الآن.",
    rateLimit: (seconds) => `انتظر ${seconds} ثانية قبل طلب محتوى آخر.`,
    dailyLimit: "لقد وصلت إلى الحد اليومي للمحتوى.",
    blocked: "تم حظر وصولك إلى البوت.",
    welcome: "مرحباً! اختر فئة من الأسفل.",
    mediaError: "لم أتمكن من إرسال هذا المحتوى الآن. جرّب مرة أخرى.",
    favoriteError: "لم أتمكن من إرسال هذا العنصر المفضل الآن.",
    premiumLifetime: "لديك وصول مدى الحياة بالفعل.",
    adminMoved: "إدارة UpMidias متاحة فقط من لوحة التحكم.",
    favorite: "⭐ إضافة للمفضلة",
    unfavorite: "💔 إزالة من المفضلة",
    removeFavorite: "💔 إزالة من المفضلة",
    deleteMedia: "حذف",
  },
  ru: {
    languageButton: "🌐 Язык",
    languagePrompt: "Выберите язык:",
    languageChanged: "Язык изменен на русский.",
    categoryHetero: "Гетеро",
    categoryTrans: "Транс",
    mediaButton: "🎬 Получить видео",
    favoritesButton: "❤️ Избранное",
    backButton: "⬅️ Назад",
    premiumButton: "Открыть полный доступ к боту",
    categoryPrompt: "Выберите категорию:",
    mediaPrompt: (category) =>
      `<b>${category}</b> выбрано. Нажмите Получить видео, чтобы получить случайный материал:`,
    categoryRequired: "Сначала выберите категорию.",
    emptyMedia: "В этой категории пока нет доступных материалов.",
    favoritesEmpty: "В этой категории у вас пока нет избранного.",
    rateLimit: (seconds) => `Подождите ${seconds} сек. перед следующим запросом.`,
    dailyLimit: "Вы достигли дневного лимита материалов.",
    blocked: "Ваш доступ к боту заблокирован.",
    welcome: "Добро пожаловать! Выберите категорию ниже.",
    mediaError: "Не удалось отправить этот материал. Попробуйте другой.",
    favoriteError: "Не удалось отправить это избранное сейчас.",
    premiumLifetime: "У вас уже есть пожизненный доступ.",
    adminMoved: "Управление UpMidias доступно только в веб-панели.",
    favorite: "⭐ В избранное",
    unfavorite: "💔 Убрать из избранного",
    removeFavorite: "💔 Убрать из избранного",
    deleteMedia: "Удалить",
  },
  th: {
    languageButton: "🌐 ภาษา",
    languagePrompt: "เลือกภาษา:",
    languageChanged: "เปลี่ยนภาษาเป็นไทยแล้ว",
    categoryHetero: "เฮเทโร",
    categoryTrans: "ทรานส์",
    mediaButton: "🎬 รับวิดีโอ",
    favoritesButton: "❤️ รายการโปรด",
    backButton: "⬅️ กลับ",
    premiumButton: "ปลดล็อกการเข้าถึงบอททั้งหมด",
    categoryPrompt: "เลือกหมวดหมู่:",
    mediaPrompt: (category) => `เลือก <b>${category}</b> แล้ว กด รับวิดีโอ เพื่อรับสื่อแบบสุ่ม:`,
    categoryRequired: "กรุณาเลือกหมวดหมู่ก่อน",
    emptyMedia: "ยังไม่มีสื่อในหมวดหมู่นี้",
    favoritesEmpty: "คุณยังไม่มีรายการโปรดในหมวดหมู่นี้",
    rateLimit: (seconds) => `รอ ${seconds} วินาทีก่อนขอสื่ออีกครั้ง`,
    dailyLimit: "คุณใช้โควตาสื่อรายวันครบแล้ว",
    blocked: "คุณถูกบล็อกจากการใช้งานบอท",
    welcome: "ยินดีต้อนรับ! เลือกหมวดหมู่ด้านล่าง",
    mediaError: "ส่งสื่อนี้ไม่ได้ในตอนนี้ ลองรายการอื่น",
    favoriteError: "ส่งรายการโปรดนี้ไม่ได้ในตอนนี้",
    premiumLifetime: "คุณมีสิทธิ์ใช้งานตลอดชีพอยู่แล้ว",
    adminMoved: "จัดการ UpMidias ได้เฉพาะในแผงควบคุมเว็บเท่านั้น",
    favorite: "⭐ เพิ่มในรายการโปรด",
    unfavorite: "💔 ลบจากรายการโปรด",
    removeFavorite: "💔 ลบจากรายการโปรด",
    deleteMedia: "ลบ",
  },
};

export function detectImageBotLanguage(value: string | null | undefined): ImageBotLanguage {
  const language = value?.trim().toLowerCase() ?? "";
  if (language.startsWith("en")) return "en";
  if (language.startsWith("es")) return "es";
  if (language.startsWith("ar") || language.startsWith("fa") || language.startsWith("ur")) {
    return "ar";
  }
  if (language.startsWith("ru")) return "ru";
  if (language.startsWith("th")) return "th";
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
  if (
    ["العربية", "عربي", "فارسی", "فارسي", "اردو", "🇸🇦 العربية", "🇦🇪 العربية"].includes(normalized)
  ) {
    return "ar";
  }
  if (["русский", "russian", "🇷🇺 русский"].includes(normalized)) return "ru";
  if (["ไทย", "thai", "ภาษาไทย", "🇹🇭 ไทย"].includes(normalized)) return "th";
  return null;
}

export const imageBotLanguageChoices = {
  pt: "🇧🇷 Português",
  en: "🇺🇸 English",
  es: "🇪🇸 Español",
  ar: "🇸🇦 العربية",
  ru: "🇷🇺 Русский",
  th: "🇹🇭 ไทย",
} satisfies Record<ImageBotLanguage, string>;
