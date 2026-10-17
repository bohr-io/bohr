-- Link in bio: the profile, its links, daily click counts and the request limiter.

-- Profile fields the owner edits in the admin (name, bio, avatar_url, theme, social_<network>).
-- An empty name shows a sample name and bio, translated to each visitor's language.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('name', ''),
  ('bio', ''),
  ('avatar_url', ''),
  ('theme', 'rose'),
  ('social_instagram', ''),
  ('social_tiktok', ''),
  ('social_youtube', ''),
  ('social_x', ''),
  ('social_linkedin', ''),
  ('social_github', '');

-- The buttons on the page, in `position` order. `clicks` is the all-time total.
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX links_position ON links (position);

-- Clicks per link per day (UTC, YYYY-MM-DD), for the admin's last-7-days numbers.
CREATE TABLE link_clicks (
  link_id INTEGER NOT NULL REFERENCES links (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day)
);
CREATE INDEX link_clicks_day ON link_clicks (day);

-- Example links (point them to your own pages in the admin) and a few clicks so the stats look alive.
INSERT INTO links (id, title, url, position, clicks) VALUES
  (1, 'Meu site', 'https://example.com/', 1, 18),
  (2, 'Instagram', 'https://example.com/instagram', 2, 11),
  (3, 'Fale comigo no WhatsApp', 'https://example.com/whatsapp', 3, 7);
INSERT INTO link_clicks (link_id, day, count) VALUES
  (1, date('now', '-6 days'), 2),
  (1, date('now', '-4 days'), 3),
  (1, date('now', '-2 days'), 4),
  (1, date('now', '-1 days'), 5),
  (1, date('now'), 4),
  (2, date('now', '-5 days'), 2),
  (2, date('now', '-3 days'), 3),
  (2, date('now', '-1 days'), 4),
  (2, date('now'), 2),
  (3, date('now', '-3 days'), 2),
  (3, date('now', '-2 days'), 1),
  (3, date('now'), 4);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
