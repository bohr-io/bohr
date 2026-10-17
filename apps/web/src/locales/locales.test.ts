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

const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

const codes = LOCALES.map(({ code }) => code);
const flat = Object.fromEntries(codes.map((code) => [code, flatten(messages[code] as Messages)]));
const source = flat['pt-BR'] ?? {};

// Every source file of the app, as text.
const sources = import.meta.glob<string>(['../**/*.vue', '../**/*.ts', '!../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Static keys the code passes to t(), <I18nT keypath>, route meta titles and status labels. */
function keysInCode(): Set<string> {
  const keys = new Set<string>();
  const patterns = [/\bt\(\s*'([\w.]+)'/g, /keypath="([\w.]+)"/g, /(?:title|label): '([a-z]\w*\.[\w.]+)'/g];
  for (const code of Object.values(sources)) {
    for (const pattern of patterns) for (const match of code.matchAll(pattern)) keys.add(match[1] ?? '');
  }
  return keys;
}

describe('locale messages', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cover pt-BR, en and es', () => {
    expect(Object.keys(messages).sort()).toEqual(['en', 'es', 'pt-BR']);
  });

  it.each(codes)('%s has exactly the same keys as pt-BR', (code) => {
    expect(Object.keys(flat[code] ?? {}).sort()).toEqual(Object.keys(source).sort());
  });

  it.each(codes)('%s has no empty messages', (code) => {
    const empty = Object.entries(flat[code] ?? {}).filter(([, message]) => message.trim() === '');
    expect(empty).toEqual([]);
  });

  it.each(codes)('%s uses the same placeholders as pt-BR', (code) => {
    for (const [key, message] of Object.entries(source)) {
      expect(placeholders(flat[code]?.[key] ?? ''), key).toEqual(placeholders(message));
    }
  });

  it.each(codes)('%s compiles and renders every message', (code) => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const i18n = createI18n({ legacy: false, locale: code, messages });

    for (const [key, message] of Object.entries(flat[code] ?? {})) {
      const params = Object.fromEntries(placeholders(message).map((name) => [name, `<${name}>`]));
      const rendered = i18n.global.t(key, params);
      expect(rendered, key).not.toBe(key);
      expect(rendered, key).not.toMatch(/[{}]/);
      if (!message.includes('{')) expect(rendered, key).toBe(message);
    }
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('has a message for every static key the code uses', () => {
    const used = keysInCode();
    expect(used.size).toBeGreaterThan(100);
    expect([...used].filter((key) => !(key in source))).toEqual([]);
  });
});
