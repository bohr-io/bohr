import type { InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup } from './types';

/** Telegram limits callback_data to 64 bytes. */
export const CALLBACK_DATA_LIMIT = 64;

/** Callback data as "action:arg1:arg2"; arguments must not contain ":". */
export function callbackData(action: string, ...args: (string | number)[]): string {
  const parts = [action, ...args.map(String)];
  if (parts.some((part) => part.includes(':'))) throw new Error('Callback data parts cannot contain ":".');
  const data = parts.join(':');
  if (new TextEncoder().encode(data).length > CALLBACK_DATA_LIMIT) {
    throw new Error(`Callback data longer than ${CALLBACK_DATA_LIMIT} bytes: ${data}`);
  }
  return data;
}

export function parseCallbackData(data: string | undefined): { action: string; args: string[] } | null {
  if (!data) return null;
  const [action, ...args] = data.split(':');
  return action ? { action, args } : null;
}

export type ButtonSpec = { text: string; data: string } | { text: string; url: string };

export function inlineKeyboard(rows: ButtonSpec[][]): InlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map(
        (button): InlineKeyboardButton =>
          'url' in button ? { text: button.text, url: button.url } : { text: button.text, callback_data: button.data },
      ),
    ),
  };
}

/**
 * A reply keyboard with one button that asks the user to create a bot managed by this one (Bot API 9.6).
 * The new bot arrives as a `managed_bot_created` service message and a `managed_bot` update.
 */
export function managedBotKeyboard(
  text: string,
  request: { requestId: number; suggestedName?: string; suggestedUsername?: string },
): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [
        {
          text,
          request_managed_bot: {
            request_id: request.requestId,
            ...(request.suggestedName ? { suggested_name: request.suggestedName } : {}),
            ...(request.suggestedUsername ? { suggested_username: request.suggestedUsername } : {}),
          },
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

/** Link that opens Telegram's "create a managed bot" screen for this manager bot. */
export function newManagedBotLink(managerUsername: string, suggestedUsername: string, suggestedName?: string): string {
  const base = `https://t.me/newbot/${encodeURIComponent(managerUsername)}/${encodeURIComponent(suggestedUsername)}`;
  return suggestedName ? `${base}?name=${encodeURIComponent(suggestedName)}` : base;
}

/** Bot usernames: 5-32 characters, letters, digits and underscores, starting with a letter and ending in "bot". */
export function suggestBotUsername(name: string, suffix: string): string {
  let base = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  if (!/^[A-Za-z]/.test(base)) base = `p${base}`;
  const username = `${base}_${suffix.replace(/[^A-Za-z0-9]/g, '')}`.replace(/_+$/, '').slice(0, 28);
  return `${username}_bot`;
}
