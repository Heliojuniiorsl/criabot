import {
  answerCallbackQueryWithToken,
  deleteWebhookWithToken,
  getUpdatesWithToken,
  sendMessageWithToken,
  sendPhotoWithToken,
  sendVideoWithToken,
  type TelegramUpdate,
} from "@/lib/telegram/api";

const PLAN_CALLBACK_DATA = "criabot:first_plan";
const PAYMENT_NOT_CONFIGURED_MESSAGE = "pagamento ainda não configurado";

export type LocalTelegramExperience = {
  welcomeMessage: string;
  buyButtonLabel: string;
  firstPlan: {
    message: string;
    buttonLabel: string;
  };
  welcomeMedia: {
    type: "none" | "photo" | "video";
    url: string;
  };
};

type LocalTelegramUpdate = TelegramUpdate & {
  message?: {
    chat?: { id: number };
    from?: { first_name?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat?: { id: number };
    };
  };
};

type PollerState = {
  token: string;
  botId: string;
  offset: number;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  experience: LocalTelegramExperience;
};

type PollerGlobal = typeof globalThis & {
  __criabotLocalTelegramPollers?: Map<string, PollerState>;
};

function getPollers() {
  const store = globalThis as PollerGlobal;
  store.__criabotLocalTelegramPollers ??= new Map();
  return store.__criabotLocalTelegramPollers;
}

function makeReplyMarkup(experience: LocalTelegramExperience) {
  return [
    [
      {
        text:
          experience.firstPlan.buttonLabel ||
          experience.buyButtonLabel ||
          "Ver ofertas",
        callback_data: PLAN_CALLBACK_DATA,
      },
    ],
  ];
}

function makeWelcomeText(
  experience: LocalTelegramExperience,
  firstName?: string,
) {
  const name = firstName?.trim() || "cliente";
  return [
    experience.welcomeMessage.replaceAll("{nome}", name).trim(),
    experience.firstPlan.message.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function sendWelcome(
  token: string,
  chatId: number,
  firstName: string | undefined,
  experience: LocalTelegramExperience,
) {
  const text = makeWelcomeText(experience, firstName);
  const keyboard = makeReplyMarkup(experience);
  const media = experience.welcomeMedia;

  if (media.type === "photo" && media.url) {
    await sendPhotoWithToken(token, chatId, media.url, text.slice(0, 1024), keyboard);
    return;
  }

  if (media.type === "video" && media.url) {
    await sendVideoWithToken(token, chatId, media.url, text.slice(0, 1024), keyboard);
    return;
  }

  await sendMessageWithToken(token, chatId, text, keyboard);
}

async function processUpdate(state: PollerState, update: LocalTelegramUpdate) {
  const callback = update.callback_query;
  if (callback?.data === PLAN_CALLBACK_DATA) {
    await answerCallbackQueryWithToken(
      state.token,
      callback.id,
      "Pagamento ainda não configurado",
    );

    const chatId = callback.message?.chat?.id;
    if (chatId) {
      await sendMessageWithToken(state.token, chatId, PAYMENT_NOT_CONFIGURED_MESSAGE);
    }
    return;
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  if (chatId && message?.text?.startsWith("/start")) {
    await sendWelcome(
      state.token,
      chatId,
      message.from?.first_name,
      state.experience,
    );
  }
}

async function tick(state: PollerState) {
  if (!state.running) return;

  try {
    const updates = await getUpdatesWithToken<LocalTelegramUpdate>(state.token, {
      offset: state.offset,
      timeout: 0,
      limit: 25,
      allowedUpdates: ["message", "callback_query"],
    });

    for (const update of updates) {
      state.offset = Math.max(state.offset, update.update_id + 1);
      await processUpdate(state, update);
    }
  } catch (error) {
    console.warn("[CriaBot local polling] erro no polling", {
      botId: state.botId,
      error,
    });
  } finally {
    if (state.running) {
      state.timer = setTimeout(() => void tick(state), 1800);
    }
  }
}

export async function startLocalTelegramPolling(input: {
  token: string;
  botId: string;
  experience: LocalTelegramExperience;
}) {
  const pollers = getPollers();
  const existing = pollers.get(input.botId);
  if (existing) {
    existing.experience = input.experience;
    existing.token = input.token;
    existing.running = true;
    if (!existing.timer) {
      existing.timer = setTimeout(() => void tick(existing), 250);
    }
    return;
  }

  await deleteWebhookWithToken(input.token, false);

  const state: PollerState = {
    token: input.token,
    botId: input.botId,
    offset: 0,
    running: true,
    timer: null,
    experience: input.experience,
  };
  pollers.set(input.botId, state);
  state.timer = setTimeout(() => void tick(state), 250);
}

export function stopLocalTelegramPolling(botId: string) {
  const pollers = getPollers();
  const existing = pollers.get(botId);
  if (!existing) return false;

  existing.running = false;
  if (existing.timer) {
    clearTimeout(existing.timer);
    existing.timer = null;
  }
  pollers.delete(botId);
  return true;
}

export async function restartLocalTelegramPolling(input: {
  token: string;
  botId: string;
  experience: LocalTelegramExperience;
}) {
  stopLocalTelegramPolling(input.botId);
  await startLocalTelegramPolling(input);
}
