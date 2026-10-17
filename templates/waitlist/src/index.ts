import { Hono } from 'hono';
import type { AppEnv } from './env';
import { auth, requireAdmin } from './lib/auth';
import { apiGuard, csvResponse, fail, onError, rateLimit, readJson, serveAssets } from './lib/http';
import { boolean, email, id, integer, text } from './lib/validate';

type Settings = {
  title: string;
  headline: string;
  description: string;
  ask_phone: boolean;
  ask_company: boolean;
  ask_note: boolean;
};
const TEXT_SETTINGS = ['title', 'headline', 'description'] as const;
const FLAG_SETTINGS = ['ask_phone', 'ask_company', 'ask_note'] as const;

async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = new Map(results.map((row) => [row.key, row.value]));
  return {
    title: map.get('title') ?? '',
    headline: map.get('headline') ?? '',
    description: map.get('description') ?? '',
    ask_phone: map.get('ask_phone') === '1',
    ask_company: map.get('ask_company') === '1',
    ask_note: map.get('ask_note') === '1',
  };
}

const app = new Hono<AppEnv>();
app.onError(onError);
app.use('/api/*', apiGuard);
app.route('/api/auth', auth);
app.use('/api/admin/*', requireAdmin);

// Public: the page texts and how many people already joined
app.get('/api/page', async (c) => {
  const [settings, count] = await Promise.all([
    loadSettings(c.env.DB),
    c.env.DB.prepare('SELECT COUNT(*) AS total FROM signups').first<number>('total'),
  ]);
  return c.json({ ...settings, count: count ?? 0 });
});

// Public: join the list
app.post('/api/signups', async (c) => {
  const body = await readJson(c, 8192);
  // Bots fill the hidden "website" field: they get a success and nothing is stored
  if (typeof body.website === 'string' && body.website !== '') return c.json({ position: 0 }, 201);
  await rateLimit(c, 'signup', 20, 10 * 60);
  const settings = await loadSettings(c.env.DB);
  const signup = {
    name: text(body.name, 'name', { max: 100, min: 2 }),
    email: email(body.email),
    phone: settings.ask_phone ? text(body.phone, 'phone', { max: 30, optional: true }) : '',
    company: settings.ask_company ? text(body.company, 'company', { max: 120, optional: true }) : '',
    note: settings.ask_note ? text(body.note, 'note', { max: 1000, optional: true, multiline: true }) : '',
    source: text(body.source, 'source', { max: 100, optional: true }),
  };
  if (signup.phone !== '' && !/^[0-9+()\-.\s]{6,30}$/.test(signup.phone)) fail(400, 'invalid_phone');
  const inserted = await c.env.DB.prepare(
    `INSERT INTO signups (name, email, phone, company, note, source) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
  )
    .bind(signup.name, signup.email, signup.phone, signup.company, signup.note, signup.source)
    .first<number>('id');
  if (inserted === null) fail(409, 'already_registered');
  const position = await c.env.DB.prepare('SELECT COUNT(*) AS position FROM signups WHERE id <= ?')
    .bind(inserted)
    .first<number>('position');
  return c.json({ position: position ?? 1 }, 201);
});

// Admin: sign-ups, newest first, with search and pages
app.get('/api/admin/signups', async (c) => {
  const query = text(c.req.query('q'), 'q', { max: 100, optional: true });
  const page = integer(c.req.query('page') ?? '1', 'page', 1, 100_000);
  const pageSize = 50;
  const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const where = query === '' ? '' : "WHERE name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\' OR company LIKE ?1 ESCAPE '\\'";
  const binds = query === '' ? [] : [like];
  const [rows, total] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT * FROM signups ${where} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).bind(
      ...binds,
    ),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM signups ${where}`).bind(...binds),
  ]);
  return c.json({ items: rows?.results ?? [], total: Number(total?.results[0]?.total ?? 0), page, pageSize });
});

app.get('/api/admin/stats', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(created_at >= strftime('%Y-%m-%dT00:00:00Z', 'now')), 0) AS today,
       COALESCE(SUM(created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')), 0) AS week
     FROM signups`,
  ).first<{ total: number; today: number; week: number }>();
  return c.json(row ?? { total: 0, today: 0, week: 0 });
});

app.delete('/api/admin/signups/:id', async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM signups WHERE id = ?').bind(id(c.req.param('id'))).run();
  if (result.meta.changes === 0) fail(404, 'not_found');
  return c.json({ ok: true });
});

app.get('/api/admin/signups.csv', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, email, phone, company, note, source, created_at FROM signups ORDER BY id',
  ).all<Record<string, unknown>>();
  const columns = ['id', 'name', 'email', 'phone', 'company', 'note', 'source', 'created_at'];
  return csvResponse(
    'waitlist.csv',
    columns,
    results.map((row) => columns.map((column) => row[column])),
  );
});

app.get('/api/admin/settings', async (c) => c.json(await loadSettings(c.env.DB)));

app.put('/api/admin/settings', async (c) => {
  const body = await readJson(c);
  const limits = { title: 80, headline: 140, description: 600 };
  const statements = [
    ...TEXT_SETTINGS.map((key) => [
      key,
      text(body[key], key, { max: limits[key], optional: true, multiline: key === 'description' }),
    ]),
    ...FLAG_SETTINGS.map((key) => [key, boolean(body[key], key) ? '1' : '0']),
  ].map(([key, value]) =>
    c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(
      key,
      value,
    ),
  );
  await c.env.DB.batch(statements);
  return c.json(await loadSettings(c.env.DB));
});

app.all('/api/*', () => fail(404, 'not_found'));
app.all('*', serveAssets);

export default app;
