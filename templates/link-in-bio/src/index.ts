import { Hono, type Context } from 'hono';
import type { AppEnv } from './env';
import { auth, requireAdmin } from './lib/auth';
import { apiGuard, fail, onError, rateLimit, readJson, serveAssets } from './lib/http';
import { boolean, id, integer, oneOf, text, url } from './lib/validate';

// Limits the admin enforces (the client mirrors them in maxlength attributes).
const MAX_LINKS = 100;
const TITLE_MAX = 80;
const NAME_MAX = 60;
const BIO_MAX = 300;

/** Color presets for the public page; each one is a set of CSS variables in public/assets/app.css. */
const THEMES = ['rose', 'violet', 'ocean', 'forest', 'sunset', 'mono'] as const;
/** Social networks shown as icons under the bio (only the handle is stored; the page builds the address). */
const SOCIALS = ['instagram', 'tiktok', 'youtube', 'x', 'linkedin', 'github'] as const;
/** Link addresses may be web pages, emails or phone numbers; never javascript: or data:. */
const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

type Social = (typeof SOCIALS)[number];
type Profile = {
  name: string;
  bio: string;
  avatar_url: string;
  theme: (typeof THEMES)[number];
  socials: Record<Social, string>;
};
type LinkRow = {
  id: number;
  title: string;
  url: string;
  position: number;
  visible: number;
  clicks: number;
  created_at: string;
};

async function loadProfile(db: D1Database): Promise<Profile> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = new Map(results.map((row) => [row.key, row.value]));
  const theme = map.get('theme') ?? '';
  return {
    name: map.get('name') ?? '',
    bio: map.get('bio') ?? '',
    avatar_url: map.get('avatar_url') ?? '',
    theme: (THEMES as readonly string[]).includes(theme) ? (theme as Profile['theme']) : 'rose',
    socials: Object.fromEntries(SOCIALS.map((network) => [network, map.get(`social_${network}`) ?? ''])) as Record<Social, string>,
  };
}

/** Which icon the public page shows next to a link, from its address. */
function linkIcon(address: string): string {
  if (address.startsWith('mailto:')) return 'mail';
  if (address.startsWith('tel:')) return 'phone';
  let host = '';
  try {
    host = new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return 'link';
  }
  const known: Record<string, string> = {
    'instagram.com': 'instagram',
    'tiktok.com': 'tiktok',
    'youtube.com': 'youtube',
    'youtu.be': 'youtube',
    'x.com': 'x',
    'twitter.com': 'x',
    'linkedin.com': 'linkedin',
    'github.com': 'github',
    'wa.me': 'whatsapp',
    'whatsapp.com': 'whatsapp',
    'api.whatsapp.com': 'whatsapp',
  };
  return known[host] ?? 'link';
}

/** A link's address: http(s), mailto: with an address or tel: with a number (kept as digits only, like tel:+5511999990000). */
function linkUrl(value: unknown): string {
  const address = url(value, 'url', { protocols: LINK_PROTOCOLS });
  if (address.startsWith('mailto:') && !/^mailto:[^\s@?]+@[^\s@?]+/.test(address)) fail(400, 'invalid_url');
  if (address.startsWith('tel:')) {
    let number = '';
    try {
      number = decodeURIComponent(address.slice(4));
    } catch {
      fail(400, 'invalid_url');
    }
    if (!/^\+?[0-9().\-\s]{3,40}$/.test(number)) fail(400, 'invalid_url');
    const digits = number.replace(/[^\d+]/g, '');
    if (!/^\+?\d{3,20}$/.test(digits)) fail(400, 'invalid_url');
    return `tel:${digits}`;
  }
  return address;
}

/** The validated fields of a link (create and update). */
function linkInput(body: Record<string, unknown>) {
  return {
    title: text(body.title, 'title', { max: TITLE_MAX }),
    url: linkUrl(body.url),
    visible: body.visible === undefined ? true : boolean(body.visible, 'visible'),
  };
}

/** Today and the 6 days before it (UTC, YYYY-MM-DD), oldest first. */
function lastSevenDays(): string[] {
  const today = Date.now();
  return Array.from({ length: 7 }, (_, index) => new Date(today - (6 - index) * 86_400_000).toISOString().slice(0, 10));
}

/** Search engines and link-preview robots open links too; their visits are not clicks. */
const ROBOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless/i;

/** Adds one click to the link's total and to today's count (at most 60 counted clicks per visitor per 10 minutes). */
async function countClick(c: Context<AppEnv>, linkId: number) {
  try {
    await rateLimit(c, 'click', 60, 10 * 60);
  } catch {
    return;
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE links SET clicks = clicks + 1 WHERE id = ?').bind(linkId),
    c.env.DB.prepare(
      `INSERT INTO link_clicks (link_id, day, count) VALUES (?, date('now'), 1)
       ON CONFLICT (link_id, day) DO UPDATE SET count = count + 1`,
    ).bind(linkId),
  ]);
}

const app = new Hono<AppEnv>();
app.onError(onError);
app.use('/api/*', apiGuard);
app.route('/api/auth', auth);
app.use('/api/admin/*', requireAdmin);

// Public: the profile and its visible links, in order (no click counts)
app.get('/api/profile', async (c) => {
  const [profile, links] = await Promise.all([
    loadProfile(c.env.DB),
    c.env.DB.prepare('SELECT id, title, url FROM links WHERE visible = 1 ORDER BY position, id').all<{
      id: number;
      title: string;
      url: string;
    }>(),
  ]);
  const socials = Object.fromEntries(Object.entries(profile.socials).filter(([, handle]) => handle !== ''));
  return c.json({
    ...profile,
    socials,
    links: links.results.map((link) => ({ id: link.id, title: link.title, icon: linkIcon(link.url) })),
  });
});

// Public: every button on the page points here. Counts the click and redirects to the link's address;
// hidden or missing links fall through to the static files (the 404 page). Works without JavaScript.
app.get('/go/:id', async (c, next) => {
  const raw = c.req.param('id');
  const link = /^\d{1,12}$/.test(raw)
    ? await c.env.DB.prepare('SELECT id, url FROM links WHERE id = ? AND visible = 1').bind(Number(raw)).first<{ id: number; url: string }>()
    : null;
  if (!link) return next();
  if (c.req.method === 'GET' && !ROBOT.test(c.req.header('user-agent') ?? '')) {
    // Counted after the answer is sent, so the visitor is redirected right away
    c.executionCtx.waitUntil(countClick(c, link.id).catch((error) => console.error(error)));
  }
  c.header('Cache-Control', 'no-store');
  return c.redirect(link.url, 302);
});

// Admin: every link with its clicks (total and per day for the last 7 days) and the page's numbers
app.get('/api/admin/links', async (c) => {
  const days = lastSevenDays();
  const [links, counts] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT * FROM links ORDER BY position, id'),
    c.env.DB.prepare('SELECT link_id, day, count FROM link_clicks WHERE day >= ?').bind(days[0]),
  ]);
  const perLink = new Map<number, number[]>();
  for (const row of (counts?.results ?? []) as { link_id: number; day: string; count: number }[]) {
    const index = days.indexOf(row.day);
    if (index === -1) continue;
    const series = perLink.get(row.link_id) ?? days.map(() => 0);
    series[index] = row.count;
    perLink.set(row.link_id, series);
  }
  const items = ((links?.results ?? []) as LinkRow[]).map((link) => {
    const series = perLink.get(link.id) ?? days.map(() => 0);
    return { ...link, visible: link.visible === 1, days: series, week: series.reduce((sum, value) => sum + value, 0) };
  });
  return c.json({
    items,
    days,
    stats: {
      total: items.reduce((sum, link) => sum + link.clicks, 0),
      week: items.reduce((sum, link) => sum + link.week, 0),
      visible: items.filter((link) => link.visible).length,
      links: items.length,
    },
    max: MAX_LINKS,
  });
});

// Admin: add a link at the end of the list (409 `too_many_links` past MAX_LINKS)
app.post('/api/admin/links', async (c) => {
  const link = linkInput(await readJson(c, 8192));
  const inserted = await c.env.DB.prepare(
    `INSERT INTO links (title, url, visible, position)
     SELECT ?, ?, ?, next FROM (SELECT COUNT(*) AS total, COALESCE(MAX(position), 0) + 1 AS next FROM links)
     WHERE total < ?
     RETURNING id`,
  )
    .bind(link.title, link.url, link.visible ? 1 : 0, MAX_LINKS)
    .first<number>('id');
  if (inserted === null) fail(409, 'too_many_links');
  return c.json({ id: inserted }, 201);
});

// Admin: the new order, as the full list of link ids (registered before /:id so "order" is not an id)
app.put('/api/admin/links/order', async (c) => {
  const body = await readJson(c, 8192);
  if (!Array.isArray(body.ids) || body.ids.length > MAX_LINKS) fail(400, 'invalid_order');
  const ids = body.ids.map((value) => integer(value, 'order', 1, Number.MAX_SAFE_INTEGER));
  const { results } = await c.env.DB.prepare('SELECT id FROM links').all<{ id: number }>();
  const existing = new Set(results.map((row) => row.id));
  // Must be every link exactly once: otherwise the list changed elsewhere and the admin reloads it
  if (new Set(ids).size !== ids.length || ids.length !== existing.size || ids.some((value) => !existing.has(value))) {
    fail(400, 'invalid_order');
  }
  if (ids.length > 0) {
    await c.env.DB.batch(ids.map((value, index) => c.env.DB.prepare('UPDATE links SET position = ? WHERE id = ?').bind(index + 1, value)));
  }
  return c.json({ ok: true });
});

app.put('/api/admin/links/:id', async (c) => {
  const linkId = id(c.req.param('id'));
  const link = linkInput(await readJson(c, 8192));
  const result = await c.env.DB.prepare('UPDATE links SET title = ?, url = ?, visible = ? WHERE id = ?')
    .bind(link.title, link.url, link.visible ? 1 : 0, linkId)
    .run();
  if (result.meta.changes === 0) fail(404, 'not_found');
  return c.json({ ok: true });
});

app.delete('/api/admin/links/:id', async (c) => {
  const linkId = id(c.req.param('id'));
  const [, removed] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM link_clicks WHERE link_id = ?').bind(linkId),
    c.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(linkId),
  ]);
  if ((removed?.meta.changes ?? 0) === 0) fail(404, 'not_found');
  return c.json({ ok: true });
});

app.get('/api/admin/profile', async (c) => c.json(await loadProfile(c.env.DB)));

app.put('/api/admin/profile', async (c) => {
  const body = await readJson(c);
  const socialsIn = typeof body.socials === 'object' && body.socials !== null ? (body.socials as Record<string, unknown>) : {};
  const values: [string, string][] = [
    ['name', text(body.name, 'name', { max: NAME_MAX, optional: true })],
    ['bio', text(body.bio, 'bio', { max: BIO_MAX, optional: true, multiline: true })],
    ['avatar_url', url(body.avatar_url, 'avatar_url', { optional: true, protocols: ['https:'] })],
    ['theme', oneOf(body.theme, 'theme', THEMES)],
    ...SOCIALS.map((network): [string, string] => {
      // Only the handle: letters, digits, dot, dash and underscore (a leading @ is dropped)
      const handle = text(socialsIn[network], 'social', { max: 60, optional: true }).replace(/^@/, '');
      if (handle !== '' && !/^[A-Za-z0-9._-]{1,60}$/.test(handle)) fail(400, 'invalid_social');
      return [`social_${network}`, handle];
    }),
  ];
  await c.env.DB.batch(
    values.map(([key, value]) =>
      c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(
        key,
        value,
      ),
    ),
  );
  return c.json(await loadProfile(c.env.DB));
});

app.all('/api/*', () => fail(404, 'not_found'));
app.all('*', serveAssets);

export default app;
