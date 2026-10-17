import type { BotCommand, BotCommandScope, ReplyMarkup, TelegramMessage, TelegramUser, WebhookInfo } from './types';

export type Fetch = typeof fetch;

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`Telegram ${method} failed (${errorCode}): ${description}`);
    this.name = 'TelegramError';
  }
}

type ApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } };

export type SendMessageParams = {
  chat_id: number | string;
  text: string;
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_markup?: ReplyMarkup;
  message_thread_id?: number;
  reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean };
  link_preview_options?: { is_disabled?: boolean };
  disable_notification?: boolean;
};

export type EditMessageTextParams = {
  chat_id: number | string;
  message_id: number;
  text: string;
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_markup?: ReplyMarkup;
  link_preview_options?: { is_disabled?: boolean };
};

/** Waits Telegram asks for when rate limited are honoured once, up to this long. */
const MAX_RETRY_AFTER_SECONDS = 10;

export class TelegramBot {
  readonly #token: string;
  readonly #fetch: Fetch;
  readonly #apiBase: string;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: { token: string; fetch?: Fetch; apiBase?: string; sleep?: (ms: number) => Promise<void> }) {
    this.#token = options.token;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#apiBase = options.apiBase ?? 'https://api.telegram.org';
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** The bot id is the token's prefix, so it is known without a request. */
  get id(): number {
    return Number(this.#token.split(':')[0]);
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.#fetch(`${this.#apiBase}/bot${this.#token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
      if (body?.ok) return body.result;
      const errorCode = body?.error_code ?? response.status;
      const description = body?.description ?? `HTTP ${response.status}`;
      const retryAfter = body?.parameters?.retry_after;
      if (errorCode === 429 && attempt === 0 && retryAfter !== undefined && retryAfter <= MAX_RETRY_AFTER_SECONDS) {
        await this.#sleep(retryAfter * 1000);
        continue;
      }
      throw new TelegramError(method, errorCode, description, retryAfter);
    }
  }

  getMe() {
    return this.call<TelegramUser>('getMe');
  }

  setWebhook(params: {
    url: string;
    secret_token: string;
    allowed_updates?: string[];
    drop_pending_updates?: boolean;
    max_connections?: number;
  }) {
    return this.call<true>('setWebhook', params);
  }

  deleteWebhook(dropPendingUpdates = false) {
    return this.call<true>('deleteWebhook', { drop_pending_updates: dropPendingUpdates });
  }

  getWebhookInfo() {
    return this.call<WebhookInfo>('getWebhookInfo');
  }

  setMyCommands(commands: BotCommand[], options: { scope?: BotCommandScope; language_code?: string } = {}) {
    return this.call<true>('setMyCommands', { commands, ...options });
  }

  setMyDescription(description: string, languageCode?: string) {
    return this.call<true>('setMyDescription', { description, language_code: languageCode });
  }

  sendMessage(params: SendMessageParams) {
    return this.call<TelegramMessage>('sendMessage', params);
  }

  /** Editing a message to the text it already has is not an error here. */
  async editMessageText(params: EditMessageTextParams): Promise<void> {
    try {
      await this.call('editMessageText', params);
    } catch (error) {
      if (error instanceof TelegramError && error.description.includes('message is not modified')) return;
      throw error;
    }
  }

  async editMessageReplyMarkup(params: { chat_id: number | string; message_id: number; reply_markup?: ReplyMarkup }) {
    try {
      await this.call('editMessageReplyMarkup', params);
    } catch (error) {
      if (error instanceof TelegramError && error.description.includes('message is not modified')) return;
      throw error;
    }
  }

  deleteMessage(chatId: number | string, messageId: number) {
    return this.call<true>('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  answerCallbackQuery(params: { callback_query_id: string; text?: string; show_alert?: boolean }) {
    return this.call<true>('answerCallbackQuery', params);
  }

  sendChatAction(chatId: number | string, action: 'typing' = 'typing') {
    return this.call<true>('sendChatAction', { chat_id: chatId, action });
  }

  /** Token of a bot the user created through this one (Bot API 9.6). */
  getManagedBotToken(botUserId: number) {
    return this.call<string>('getManagedBotToken', { user_id: botUserId });
  }

  /** Revokes a managed bot's token and returns a new one. */
  replaceManagedBotToken(botUserId: number) {
    return this.call<string>('replaceManagedBotToken', { user_id: botUserId });
  }

  /** Restricts who can talk to a managed bot (Bot API 10.0); the owner always can. */
  setManagedBotAccessSettings(botUserId: number, settings: { isAccessRestricted: boolean; addedUserIds?: number[] }) {
    return this.call<true>('setManagedBotAccessSettings', {
      user_id: botUserId,
      is_access_restricted: settings.isAccessRestricted,
      ...(settings.addedUserIds !== undefined ? { added_user_ids: settings.addedUserIds } : {}),
    });
  }
}
