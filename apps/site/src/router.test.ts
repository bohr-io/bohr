import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { ssgOptions } from './build-config';
import { ALL_PATHS, LOCALES, localePath } from './i18n/locales';
import { localeFromPath, routes } from './router';

const EXPECTED_PATHS = ['/', '/migration', '/pt/', '/pt/migration', '/es/', '/es/migration'];

describe('routes', () => {
  it('lists every page in every locale', () => {
    expect([...ALL_PATHS].sort()).toEqual([...EXPECTED_PATHS].sort());
  });

  it('prerenders every locale page through includedRoutes', async () => {
    const included = await ssgOptions.includedRoutes?.(['/', '/:pathMatch(.*)*'], routes);

    expect([...(included ?? [])].sort()).toEqual([...EXPECTED_PATHS].sort());
  });

  it.each(LOCALES.flatMap(({ code }) => (['home', 'migration'] as const).map((page) => [code, page] as const)))(
    'resolves the %s %s page',
    (code, page) => {
      const router = createRouter({ history: createMemoryHistory(), routes });
      const resolved = router.resolve(localePath(code, page));

      expect(resolved.meta.locale).toBe(code);
      expect(resolved.meta.page).toBe(page);
    },
  );

  it('accepts locale homes without the trailing slash', () => {
    const router = createRouter({ history: createMemoryHistory(), routes });

    expect(router.resolve('/pt').meta.locale).toBe('pt-BR');
    expect(router.resolve('/es').meta.page).toBe('home');
  });

  it.each([
    ['/nowhere', '/'],
    ['/pt/nowhere', '/pt/'],
    ['/es/a/b', '/es/'],
  ])('redirects %s to %s', async (from, to) => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push(from);

    expect(router.currentRoute.value.path).toBe(to);
  });

  it('derives the locale from the path prefix', () => {
    expect(localeFromPath('/pt/migration')).toBe('pt-BR');
    expect(localeFromPath('/es')).toBe('es-ES');
    expect(localeFromPath('/pricing')).toBe('en-US');
    expect(localeFromPath('/ptx')).toBe('en-US');
  });
});
