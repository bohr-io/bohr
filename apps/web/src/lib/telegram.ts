// Telegram links and bot tokens.

/** A bot token from BotFather ("123456:ABC..."), as the instance validates it. */
export const BOT_TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

export function botUrl(username: string): string {
  return `https://t.me/${encodeURIComponent(username)}`;
}
