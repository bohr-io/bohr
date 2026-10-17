import type { TelegramMessage } from './types';

/** Escapes text for parse_mode HTML. */
export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const MESSAGE_LIMIT = 4096;

/** Splits text into messages Telegram accepts, preferring paragraph and line breaks. */
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf('\n\n');
    if (cut < limit / 2) cut = window.lastIndexOf('\n');
    if (cut < limit / 2) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0 || parts.length === 0) parts.push(rest);
  return parts;
}

/** Cuts text to a length, ending with an ellipsis when it was cut. */
export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export type ParsedCommand = { command: string; args: string };

/**
 * The command at the start of a message: "/join K7P2-9QXM" or "/join@MyBot K7P2-9QXM".
 * Commands addressed to another bot (common in groups) return null.
 */
export function parseCommand(message: Pick<TelegramMessage, 'text'>, botUsername?: string): ParsedCommand | null {
  const match = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec(message.text?.trim() ?? '');
  if (match === null) return null;
  const [, command = '', target, args = ''] = match;
  if (target !== undefined && botUsername !== undefined && target.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }
  return { command: command.toLowerCase(), args: args.trim() };
}

/** Display name of a Telegram user. */
export function displayName(user: { first_name: string; last_name?: string; username?: string }): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Telegram user';
}
