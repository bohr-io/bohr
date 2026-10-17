import { describe, expect, it } from 'vitest';
import { detectLocale, matchLocale } from '../i18n/locales';
import { parseLog } from './build-log';
import { formatRelative, formatUsd } from './format';
import { linkify } from './linkify';
import { screenshotUrl } from './screenshots';
import { buildIndicator } from './status';
import { botUrl } from './telegram';

describe('linkify', () => {
  it('turns http(s) URLs into links and leaves the punctuation around them as text', () => {
    expect(linkify('Homologação: https://loja.example.dev/carrinho. Custo: US$ 0,42')).toEqual([
      { type: 'text', text: 'Homologação: ' },
      { type: 'link', text: 'https://loja.example.dev/carrinho', href: 'https://loja.example.dev/carrinho' },
      { type: 'text', text: '. Custo: US$ 0,42' },
    ]);
  });

  it('never links other schemes', () => {
    expect(linkify('javascript:alert(1) ftp://x.example')).toEqual([
      { type: 'text', text: 'javascript:alert(1) ftp://x.example' },
    ]);
  });

  it('handles text without links and several links', () => {
    expect(linkify('')).toEqual([]);
    expect(linkify('PR (https://github.com/a/b/pull/1) e https://x.dev')).toEqual([
      { type: 'text', text: 'PR (' },
      { type: 'link', text: 'https://github.com/a/b/pull/1', href: 'https://github.com/a/b/pull/1' },
      { type: 'text', text: ') e ' },
      { type: 'link', text: 'https://x.dev', href: 'https://x.dev' },
    ]);
  });
});

describe('project screenshots', () => {
  it("loads a project's picture from the instance, versioned by its latest deploy", () => {
    const project = { id: 'p 1', productionUrl: 'https://loja.example', lastDeploy: null };
    expect(screenshotUrl(project)).toBe('/api/projects/p%201/screenshot');
    expect(
      screenshotUrl({
        ...project,
        lastDeploy: { status: 'success', branch: 'main', createdAt: '2026-10-12T10:00:00.000Z' },
      }),
    ).toBe('/api/projects/p%201/screenshot?v=2026-10-12T10%3A00%3A00.000Z');
  });

  it('has none for a project without a production address', () => {
    expect(screenshotUrl({ id: 'p1', productionUrl: null })).toBeNull();
  });
});

describe('Telegram links', () => {
  it('links to a bot', () => {
    expect(botUrl('loja_bot')).toBe('https://t.me/loja_bot');
  });
});

describe('builds', () => {
  it('reads a run from its status and conclusion', () => {
    expect(buildIndicator('queued', null)).toEqual({ status: 'warning', label: 'builds.status.queued' });
    expect(buildIndicator('in_progress', null)).toEqual({ status: 'warning', label: 'builds.status.running' });
    expect(buildIndicator('completed', 'success')).toEqual({ status: 'success', label: 'builds.status.success' });
    expect(buildIndicator('completed', 'timed_out').status).toBe('error');
    expect(buildIndicator('completed', 'cancelled').label).toBe('builds.status.cancelled');
    expect(buildIndicator('completed', 'skipped').label).toBe('builds.status.skipped');
  });

  it('drops the timestamps of a log and reads its workflow commands', () => {
    const log = [
      '2026-10-11T12:00:00.1234567Z ##[group]Run pnpm install',
      '2026-10-11T12:00:01.0000000Z pnpm install --frozen-lockfile',
      '2026-10-11T12:00:02.0000000Z ##[endgroup]',
      '2026-10-11T12:00:03.0000000Z ##[warning]Node 20 is deprecated',
      '2026-10-11T12:00:04.0000000Z ##[error]Process completed with exit code 1.',
      '',
    ].join('\r\n');
    expect(parseLog(log)).toEqual([
      { text: 'Run pnpm install', kind: 'group' },
      { text: 'pnpm install --frozen-lockfile', kind: 'plain' },
      { text: 'Node 20 is deprecated', kind: 'warning' },
      { text: 'Process completed with exit code 1.', kind: 'error' },
    ]);
    expect(parseLog('')).toEqual([]);
  });
});

describe('interface language', () => {
  it('maps browser languages to the supported locales, pt-BR by default', () => {
    expect(matchLocale('pt-PT')).toBe('pt-BR');
    expect(matchLocale('es-419')).toBe('es');
    expect(matchLocale('en_GB')).toBe('en');
    expect(matchLocale('fr')).toBeNull();
    expect(detectLocale(['fr-FR', 'es-AR', 'en'])).toBe('es');
    expect(detectLocale(['de'])).toBe('pt-BR');
    expect(detectLocale([])).toBe('pt-BR');
  });
});

describe('formatting', () => {
  it('formats dollars and relative dates in the interface language', () => {
    expect(formatUsd(10, 'en', 0)).toBe('$10');
    expect(formatUsd(5, 'pt-BR')).toMatch(/^US\$\s5$/);
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(formatRelative('2026-10-12T12:00:00Z', 'en', now)).toBe('tomorrow');
    expect(formatRelative('2026-10-11T11:55:00Z', 'en', now)).toBe('5 minutes ago');
  });
});
