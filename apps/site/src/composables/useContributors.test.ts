import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommunitySection from '../components/home/CommunitySection.vue';
import { CONTRIBUTORS_API_URL } from '../config';
import { createSiteI18n } from '../i18n';
import { stubFetch } from '../test-utils';
import { mergeContributors, parseContributors, toPeople, V1_CONTRIBUTORS } from './useContributors';

const contributor = (login: string, extra: Record<string, unknown> = {}) => ({
  login,
  avatar_url: `https://avatars.githubusercontent.com/u/${login.length}?v=4`,
  html_url: `https://github.com/${login}`,
  type: 'User',
  contributions: 1,
  ...extra,
});

const person = (login: string, contributions: number) => ({
  login,
  avatarUrl: `https://avatars.githubusercontent.com/u/${login.length}?v=4`,
  href: `https://github.com/${login}`,
  contributions,
});

async function mountCommunity() {
  const wrapper = mount(CommunitySection, { global: { plugins: [createSiteI18n('en-US')] } });
  await flushPromises();
  return wrapper;
}

const wallNames = (wrapper: Awaited<ReturnType<typeof mountCommunity>>) =>
  wrapper.findAll('.bohr-avatar-wall img').map((image) => image.attributes('alt'));

const v1Names = V1_CONTRIBUTORS.map((entry) => entry.login);

describe('parseContributors', () => {
  it('keeps people, drops bots and malformed entries', () => {
    const people = parseContributors([
      contributor('ana', { contributions: 7 }),
      contributor('dependabot[bot]'),
      contributor('robot', { type: 'Bot' }),
      { login: 'no-avatar', html_url: 'https://github.com/no-avatar' },
      contributor('evil', { html_url: 'javascript:alert(1)' }),
    ]);

    expect(people).toEqual([person('ana', 7)]);
  });

  it('ignores anything that is not a list', () => {
    expect(parseContributors({ message: 'Not Found' })).toEqual([]);
    expect(parseContributors(null)).toEqual([]);
  });
});

describe('mergeContributors', () => {
  it('lists each person once, adding up their contributions, the most active first', () => {
    const merged = mergeContributors([person('ana', 3), person('Bruno', 10)], [person('bruno', 4), person('caio', 5)]);

    expect(merged.map(({ login, contributions }) => [login, contributions])).toEqual([
      ['Bruno', 14],
      ['caio', 5],
      ['ana', 3],
    ]);
  });

  it('asks GitHub for small avatars', () => {
    expect(toPeople([person('ana', 1)])).toEqual([
      { name: 'ana', avatarUrl: 'https://avatars.githubusercontent.com/u/3?v=4&s=128', href: 'https://github.com/ana' },
    ]);
  });
});

describe('v1 contributors', () => {
  it('are people with a GitHub profile, without bots, the most active first', () => {
    expect(V1_CONTRIBUTORS.length).toBeGreaterThan(1);
    for (const entry of V1_CONTRIBUTORS) {
      expect(entry.avatarUrl).toMatch(/^https:\/\/avatars\.githubusercontent\.com\//);
      expect(entry.href).toBe(`https://github.com/${entry.login}`);
      expect(entry.login).not.toMatch(/\[bot\]$|^bohr-bot$/);
    }
    const counts = V1_CONTRIBUTORS.map((entry) => entry.contributions);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe('community contributors wall', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds bohr-io/bohr's contributors to v1's, once each", async () => {
    const top = V1_CONTRIBUTORS[0];
    if (top === undefined) throw new Error('No v1 contributors');
    const fetch = vi.fn(
      stubFetch(200, [contributor(top.login.toUpperCase(), { contributions: 5 }), contributor('newcomer')]),
    );
    vi.stubGlobal('fetch', fetch);
    const wrapper = await mountCommunity();

    expect(fetch.mock.calls[0]?.[0]).toBe(`${CONTRIBUTORS_API_URL}?per_page=100`);
    const names = wallNames(wrapper);
    expect(names).toHaveLength(V1_CONTRIBUTORS.length + 1);
    expect(names[0]).toBe(top.login);
    expect(names.at(-1)).toBe('newcomer');
  });

  it.each([
    ['a private repository', stubFetch(404, { message: 'Not Found' })],
    ['an empty repository', stubFetch(204)],
    ['an empty list', stubFetch(200, [])],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])("keeps v1's contributors for %s", async (_, response) => {
    vi.stubGlobal('fetch', vi.fn(response));
    const wrapper = await mountCommunity();

    expect(wallNames(wrapper)).toEqual(v1Names);
    expect(wrapper.find('.discord').exists()).toBe(true);
  });
});
