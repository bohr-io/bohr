import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { messages } from '../i18n';
import { LOCALES } from '../i18n/locales';

type Messages = { [key: string]: string | Messages };

/** "a.b.c" -> message, for every leaf. */
function flatten(tree: Messages, prefix = '', leaves: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') leaves[path] = value;
    else flatten(value, path, leaves);
  }
  return leaves;
}

const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

const flat = Object.fromEntries(LOCALES.map(({ code }) => [code, flatten(messages[code] as Messages)]));
const source = flat['pt-BR'] ?? {};

describe('locale messages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cover the three site locales', () => {
    expect(Object.keys(messages).sort()).toEqual(['en-US', 'es-ES', 'pt-BR']);
  });

  it.each(LOCALES.map(({ code }) => code))('%s has exactly the same keys as pt-BR', (code) => {
    expect(Object.keys(flat[code] ?? {}).sort()).toEqual(Object.keys(source).sort());
  });

  it.each(LOCALES.map(({ code }) => code))('%s has no empty messages', (code) => {
    const empty = Object.entries(flat[code] ?? {}).filter(([, message]) => message.trim() === '');
    expect(empty).toEqual([]);
  });

  it.each(LOCALES.map(({ code }) => code))('%s uses the same placeholders as pt-BR', (code) => {
    for (const [key, message] of Object.entries(source)) {
      expect(placeholders(flat[code]?.[key] ?? ''), key).toEqual(placeholders(message));
    }
  });

  it.each(LOCALES.map(({ code }) => code))('%s compiles and renders every message', (code) => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const i18n = createI18n({ legacy: false, locale: code, messages });
    const params = { command: '/rollback', panel: 'panel', discord: 'Discord', email: 'contact@bohr.io' };

    for (const [key, message] of Object.entries(flat[code] ?? {})) {
      const rendered = i18n.global.t(key, params);
      expect(rendered, key).not.toBe(key);
      expect(rendered, key).not.toMatch(/[{}]/);
      if (!message.includes('{')) expect(rendered, key).toBe(message);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
