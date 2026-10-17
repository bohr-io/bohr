import { describe, expect, it, vi } from 'vitest';
import {
  callbackData,
  displayName,
  escapeHtml,
  inlineKeyboard,
  managedBotKeyboard,
  newManagedBotLink,
  newWebhookSecret,
  parseCallbackData,
  parseCommand,
  readWebhookUpdate,
  splitMessage,
  suggestBotUsername,
  TelegramBot,
  TelegramError,
  verifyWebhookSecret,
} from '../src/index';

function fakeTelegram(responses: unknown[]) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    return Response.json(next, { status: (next as { error_code?: number }).error_code ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

describe('TelegramBot', () => {
  it('posts JSON to the method URL and returns the result', async () => {
    const { calls, fetch } = fakeTelegram([
      { ok: true, result: { message_id: 7, date: 1, chat: { id: 1, type: 'private' } } },
    ]);
    const bot = new TelegramBot({ token: '123:abc', fetch });

    const message = await bot.sendMessage({ chat_id: 1, text: 'hi', parse_mode: 'HTML' });

    expect(message.message_id).toBe(7);
    expect(calls[0]?.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(calls[0]?.body).toEqual({ chat_id: 1, text: 'hi', parse_mode: 'HTML' });
    expect(bot.id).toBe(123);
  });

  it('waits once when rate limited, then gives up', async () => {
    const limited = { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 2 } };
    const sleep = vi.fn(async () => {});
    const { fetch } = fakeTelegram([limited, { ok: true, result: true }, limited, limited]);
    const bot = new TelegramBot({ token: '1:x', fetch, sleep });

    await expect(bot.sendChatAction(1)).resolves.toBe(true);
    expect(sleep).toHaveBeenCalledWith(2000);
    await expect(bot.sendChatAction(1)).rejects.toMatchObject({ errorCode: 429, retryAfter: 2 });
  });

  it('treats an unchanged edit as done and reports other errors', async () => {
    const { fetch } = fakeTelegram([
      { ok: false, error_code: 400, description: 'Bad Request: message is not modified' },
      { ok: false, error_code: 400, description: 'Bad Request: message to edit not found' },
    ]);
    const bot = new TelegramBot({ token: '1:x', fetch });

    await expect(bot.editMessageText({ chat_id: 1, message_id: 2, text: 'same' })).resolves.toBeUndefined();
    await expect(bot.editMessageText({ chat_id: 1, message_id: 3, text: 'x' })).rejects.toBeInstanceOf(TelegramError);
  });

  it('fetches and restricts managed bots', async () => {
    const { calls, fetch } = fakeTelegram([
      { ok: true, result: '999:new-token' },
      { ok: true, result: true },
    ]);
    const bot = new TelegramBot({ token: '1:x', fetch });

    expect(await bot.getManagedBotToken(999)).toBe('999:new-token');
    await bot.setManagedBotAccessSettings(999, { isAccessRestricted: false });
    expect(calls.map((call) => call.body)).toEqual([{ user_id: 999 }, { user_id: 999, is_access_restricted: false }]);
  });
});

describe('webhooks', () => {
  const update = {
    update_id: 1,
    message: {
      message_id: 5,
      date: 1,
      chat: { id: 42, type: 'private' },
      from: { id: 42, is_bot: false, first_name: 'Ada', language_code: 'pt-br' },
      text: '/start',
      unknown_field: true,
    },
  };

  it('accepts updates with the right secret only', async () => {
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{48}$/);
    const request = (token: string | null, body: unknown = update) =>
      new Request('https://p.example/__bohr/telegram', {
        method: 'POST',
        headers: token === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': token },
        body: JSON.stringify(body),
      });

    const parsed = await readWebhookUpdate(request(secret), secret);
    expect(parsed?.message?.from?.first_name).toBe('Ada');
    expect(parsed?.message).not.toHaveProperty('unknown_field');
    expect(await readWebhookUpdate(request('wrong'), secret)).toBeNull();
    expect(await readWebhookUpdate(request(null), secret)).toBeNull();
    expect(await readWebhookUpdate(request(secret, { nope: 1 }), secret)).toBeNull();
    expect(verifyWebhookSecret('', '')).toBe(false);
  });

  it('parses managed bot service messages and updates', async () => {
    const secret = 's';
    const body = {
      update_id: 2,
      managed_bot: {
        user: { id: 42, is_bot: false, first_name: 'Ada' },
        bot: { id: 999, is_bot: true, first_name: 'Shop', username: 'shop_x1_bot' },
      },
    };
    const parsed = await readWebhookUpdate(
      new Request('https://p.example/', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
        body: JSON.stringify(body),
      }),
      secret,
    );
    expect(parsed?.managed_bot?.bot.username).toBe('shop_x1_bot');
  });
});

describe('formatting and keyboards', () => {
  it('parses commands, including ones addressed to a bot', () => {
    expect(parseCommand({ text: '/join K7P2-9QXM' })).toEqual({ command: 'join', args: 'K7P2-9QXM' });
    expect(parseCommand({ text: '/Status@ShopBot' }, 'shopbot')).toEqual({ command: 'status', args: '' });
    expect(parseCommand({ text: '/status@OtherBot' }, 'ShopBot')).toBeNull();
    expect(parseCommand({ text: 'hello /start' })).toBeNull();
    expect(parseCommand({ text: '/ask make it\nblue' })).toEqual({ command: 'ask', args: 'make it\nblue' });
  });

  it('escapes HTML and splits long texts on line breaks', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
    const text = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`;
    const parts = splitMessage(text);
    expect(parts).toEqual(['a'.repeat(3000), 'b'.repeat(3000)]);
    expect(splitMessage('x'.repeat(5000)).map((part) => part.length)).toEqual([4096, 904]);
    expect(splitMessage('')).toEqual(['']);
  });

  it('builds callback data within the size limit', () => {
    expect(callbackData('approve', 12)).toBe('approve:12');
    expect(parseCallbackData('answer:req_1:2')).toEqual({ action: 'answer', args: ['req_1', '2'] });
    expect(parseCallbackData(undefined)).toBeNull();
    expect(() => callbackData('x', 'a:b')).toThrow();
    expect(() => callbackData('x', 'y'.repeat(64))).toThrow();
  });

  it('builds keyboards and managed bot links', () => {
    expect(
      inlineKeyboard([
        [
          { text: 'Ok', data: 'ok' },
          { text: 'Site', url: 'https://x.dev' },
        ],
      ]),
    ).toEqual({
      inline_keyboard: [
        [
          { text: 'Ok', callback_data: 'ok' },
          { text: 'Site', url: 'https://x.dev' },
        ],
      ],
    });
    expect(managedBotKeyboard('Create', { requestId: 1, suggestedName: 'Shop' }).keyboard[0]?.[0]).toEqual({
      text: 'Create',
      request_managed_bot: { request_id: 1, suggested_name: 'Shop' },
    });
    expect(newManagedBotLink('bohr_bot', 'shop_bot', 'My Shop')).toBe(
      'https://t.me/newbot/bohr_bot/shop_bot?name=My%20Shop',
    );
  });

  it('suggests valid bot usernames', () => {
    for (const name of ['Loja da Ana', '123 shop', 'ã', 'a'.repeat(80)]) {
      const username = suggestBotUsername(name, 'x7k2');
      expect(username).toMatch(/^[A-Za-z][A-Za-z0-9_]{1,27}_bot$/);
      expect(username.length).toBeLessThanOrEqual(32);
      expect(username.length).toBeGreaterThanOrEqual(5);
    }
    expect(displayName({ first_name: 'Ada', last_name: 'L' })).toBe('Ada L');
  });
});
