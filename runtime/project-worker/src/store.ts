import type { HomologStatus, ReleaseStatus, RequestStatus, Role } from '@bohr/shared';

// The project's state, in the Durable Object's SQLite database. Every call is synchronous, so a
// sequence of calls without an await in between is atomic.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS members (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invites (
    code_hash TEXT PRIMARY KEY, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL, used_by TEXT, used_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY, position INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
    text TEXT NOT NULL, author_key TEXT NOT NULL, author_name TEXT NOT NULL, source TEXT NOT NULL,
    chat_id INTEGER, progress_message_id INTEGER, created_at TEXT NOT NULL, started_at TEXT,
    finished_at TEXT, summary TEXT, cost_usd REAL, session_id TEXT, resume_session_id TEXT,
    head_sha TEXT, question TEXT, error TEXT, progress TEXT, cycle INTEGER NOT NULL,
    allow_workflow_edits INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS requests_status ON requests (status, position)`,
  `CREATE TABLE IF NOT EXISTS chat (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, request_id TEXT,
    author_key TEXT, author_name TEXT, text TEXT NOT NULL, actions TEXT NOT NULL DEFAULT '[]',
    options TEXT NOT NULL DEFAULT '[]')`,
  `CREATE TABLE IF NOT EXISTS releases (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, pull_request INTEGER, pull_request_node_id TEXT,
    commit_sha TEXT, summary TEXT NOT NULL, created_at TEXT NOT NULL, approved_by TEXT,
    chat_id INTEGER, run_url TEXT, checked_at TEXT)`,
];

/** Changes to tables that already exist, applied once each, in order (settings.schema_version counts them). */
const MIGRATIONS = [
  // How the request's agent authenticated ("api_key" or "oauth", the owner's Claude subscription)
  `ALTER TABLE requests ADD COLUMN auth TEXT`,
];

/** An import that asked the user a question nobody answered yet. */
const IMPORT_AWAITING_ANSWER = "kind = 'import' AND status = 'needs_input' AND question IS NOT NULL";

export type MemberRow = { key: string; name: string; role: Role; joined_at: string };

export type RequestRow = {
  id: string;
  position: number;
  kind: 'import' | 'change';
  status: RequestStatus;
  text: string;
  author_key: string;
  author_name: string;
  source: 'telegram' | 'web';
  chat_id: number | null;
  progress_message_id: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  summary: string | null;
  cost_usd: number | null;
  session_id: string | null;
  resume_session_id: string | null;
  head_sha: string | null;
  question: string | null;
  error: string | null;
  progress: string | null;
  cycle: number;
  allow_workflow_edits: number;
  /** Set when the request starts: a Claude subscription ("oauth") is not billed per request. */
  auth: 'api_key' | 'oauth' | null;
};

export type ChatRow = {
  seq: number;
  at: string;
  kind: 'user' | 'agent' | 'progress' | 'system';
  request_id: string | null;
  author_key: string | null;
  author_name: string | null;
  text: string;
  actions: string;
  options: string;
};

export type ReleaseRow = {
  id: string;
  status: ReleaseStatus;
  pull_request: number | null;
  pull_request_node_id: string | null;
  commit_sha: string | null;
  summary: string;
  created_at: string;
  approved_by: string | null;
  chat_id: number | null;
  run_url: string | null;
  checked_at: string | null;
};

export type Settings = {
  /** A runtime update waits for the running request before restarting this object on the new code. */
  restart_pending: string;
  model: string;
  max_budget_usd: string;
  max_turns: string;
  locale: string;
  homolog_status: HomologStatus;
  homolog_version: string;
  homolog_head_sha: string;
  /** Increases when the preview is approved or discarded; agent sessions continue within a cycle. */
  cycle: string;
  last_session_id: string;
  runner_last_seq: string;
  preview_status: string;
  preview_port: string;
  /** Telegram chat that receives project-wide notices (the owner's first chat with the bot). */
  notify_chat_id: string;
  telegram_username: string;
  commands_set: string;
  /** 1 once an import succeeded, or the production branch turned out to be prepared already. */
  imported: string;
  /** Imports queued again by bohr after an interruption; there is only one such retry. */
  import_retries: string;
  /** The change request an import was queued in front of, so a failing import does not repeat for it. */
  import_first_request: string;
  /** Why the preview is stopped (see PREVIEW_STOP_REASONS). */
  preview_reason: string;
  schema_version: string;
  /** The Telegram message that offers the current decision; its buttons go away when it is superseded. */
  decision_chat_id: string;
  decision_message_id: string;
  rollback_in_progress: string;
};

type Row = Record<string, SqlStorageValue>;

export class Store {
  constructor(private readonly sql: SqlStorage) {
    for (const statement of SCHEMA) sql.exec(statement);
    const applied = this.number('schema_version', 0);
    for (const statement of MIGRATIONS.slice(applied)) sql.exec(statement);
    if (applied < MIGRATIONS.length) this.set('schema_version', MIGRATIONS.length);
  }

  private all<T>(query: string, ...params: SqlStorageValue[]): T[] {
    return this.sql.exec<Row>(query, ...params).toArray() as T[];
  }

  private one<T>(query: string, ...params: SqlStorageValue[]): T | null {
    return this.all<T>(query, ...params)[0] ?? null;
  }

  // Settings

  get<K extends keyof Settings>(key: K): Settings[K] | null {
    return (this.one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? null) as
      | Settings[K]
      | null;
  }

  set<K extends keyof Settings>(key: K, value: Settings[K] | number): void {
    this.sql.exec(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      key,
      String(value),
    );
  }

  unset(key: keyof Settings): void {
    this.sql.exec('DELETE FROM settings WHERE key = ?', key);
  }

  number(key: keyof Settings, fallback: number): number {
    const value = Number(this.get(key));
    return this.get(key) === null || Number.isNaN(value) ? fallback : value;
  }

  // Members and invites

  member(key: string): MemberRow | null {
    return this.one<MemberRow>('SELECT * FROM members WHERE key = ?', key);
  }

  members(): MemberRow[] {
    return this.all<MemberRow>("SELECT * FROM members ORDER BY role = 'owner' DESC, joined_at, key");
  }

  addMember(member: { key: string; name: string; role: Role }, now: Date): void {
    this.sql.exec(
      'INSERT INTO members (key, name, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET name = excluded.name',
      member.key,
      member.name,
      member.role,
      now.toISOString(),
    );
  }

  removeMember(key: string): void {
    this.sql.exec("DELETE FROM members WHERE key = ? AND role <> 'owner'", key);
  }

  /** The same person under another key (an owner seeded as u:<id> who now arrives as tg:<id>). */
  rekeyMember(from: string, to: string): void {
    if (this.member(to) !== null) return;
    this.sql.exec('UPDATE members SET key = ? WHERE key = ?', to, from);
  }

  /** The project's original owner (OWNER_KEY) keeps the owner role whatever an organization says. */
  setMemberRole(key: string, role: Role, protectedKey: string): void {
    if (key === protectedKey) return;
    this.sql.exec('UPDATE members SET role = ? WHERE key = ? AND role <> ?', role, key, role);
  }

  renameMember(key: string, name: string): void {
    this.sql.exec('UPDATE members SET name = ? WHERE key = ? AND name <> ?', name, key, name);
  }

  addInvite(codeHash: string, createdBy: string, now: Date, ttlMs: number): void {
    this.sql.exec(
      'INSERT INTO invites (code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)',
      codeHash,
      createdBy,
      now.toISOString(),
      now.getTime() + ttlMs,
    );
  }

  /** Marks the invite used and returns true, once; false when unknown, used or expired. */
  redeemInvite(codeHash: string, usedBy: string, now: Date): boolean {
    const result = this.sql.exec(
      'UPDATE invites SET used_by = ?, used_at = ? WHERE code_hash = ? AND used_by IS NULL AND expires_at > ?',
      usedBy,
      now.toISOString(),
      codeHash,
      now.getTime(),
    );
    return result.rowsWritten > 0;
  }

  deleteExpiredInvites(now: Date): void {
    this.sql.exec('DELETE FROM invites WHERE expires_at < ?', now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  // Requests

  request(id: string): RequestRow | null {
    return this.one<RequestRow>('SELECT * FROM requests WHERE id = ?', id);
  }

  running(): RequestRow | null {
    return this.one<RequestRow>("SELECT * FROM requests WHERE status = 'running' LIMIT 1");
  }

  queued(): RequestRow[] {
    return this.all<RequestRow>("SELECT * FROM requests WHERE status = 'queued' ORDER BY position");
  }

  /** The newest unanswered question in a chat (or on the web, with chatId null). */
  awaitingAnswer(chatId: number | null): RequestRow | null {
    return chatId === null
      ? this.one<RequestRow>(
          "SELECT * FROM requests WHERE status = 'needs_input' AND question IS NOT NULL AND source = 'web' ORDER BY position DESC LIMIT 1",
        )
      : this.one<RequestRow>(
          "SELECT * FROM requests WHERE status = 'needs_input' AND question IS NOT NULL AND chat_id = ? ORDER BY position DESC LIMIT 1",
          chatId,
        );
  }

  /** Requests a member can still cancel, newest first: an import's open question too, since it holds the queue. */
  cancellable(authorKey: string | null): RequestRow[] {
    const cancellable = `(status IN ('running', 'queued') OR (${IMPORT_AWAITING_ANSWER}))`;
    return authorKey === null
      ? this.all<RequestRow>(`SELECT * FROM requests WHERE ${cancellable} ORDER BY position DESC`)
      : this.all<RequestRow>(
          `SELECT * FROM requests WHERE ${cancellable} AND author_key = ? ORDER BY position DESC`,
          authorKey,
        );
  }

  requestsInCycle(cycle: number): RequestRow[] {
    return this.all<RequestRow>(
      "SELECT * FROM requests WHERE cycle = ? AND status = 'succeeded' AND head_sha IS NOT NULL ORDER BY position",
      cycle,
    );
  }

  /**
   * The import that is queued, running or waiting for an answer, if any. An answered question is not waiting any
   * more: the answer is an import of its own (Project.answerOptions).
   */
  activeImport(): RequestRow | null {
    return this.one<RequestRow>(
      `SELECT * FROM requests WHERE kind = 'import' AND (status IN ('queued', 'running') OR (${IMPORT_AWAITING_ANSWER})) ORDER BY position DESC LIMIT 1`,
    );
  }

  /** The import whose question waits for an answer, if any: the queue waits for it too (Project.queueHeld). */
  importAwaitingAnswer(): RequestRow | null {
    return this.one<RequestRow>(
      `SELECT * FROM requests WHERE ${IMPORT_AWAITING_ANSWER} ORDER BY position DESC LIMIT 1`,
    );
  }

  /** The newest import, whatever its status. */
  latestImport(): RequestRow | null {
    return this.one<RequestRow>("SELECT * FROM requests WHERE kind = 'import' ORDER BY position DESC LIMIT 1");
  }

  /** Adds a request at the end of the queue, or in front of every queued one with `ahead`. */
  insertRequest(request: Omit<RequestRow, 'position'>, options: { ahead?: boolean } = {}): RequestRow {
    const first = options.ahead
      ? (this.one<{ position: number | null }>("SELECT MIN(position) AS position FROM requests WHERE status = 'queued'")
          ?.position ?? null)
      : null;
    if (first !== null) this.sql.exec('UPDATE requests SET position = position + 1 WHERE position >= ?', first);
    const position =
      first ??
      ((this.one<{ next: number }>('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM requests')?.next ??
        1) as number);
    const row = { ...request, position };
    const columns = Object.keys(row);
    this.sql.exec(
      `INSERT INTO requests (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      ...columns.map((column) => row[column as keyof RequestRow] as SqlStorageValue),
    );
    return row;
  }

  updateRequest(id: string, fields: Partial<Omit<RequestRow, 'id' | 'position'>>): void {
    const entries = Object.entries(fields);
    if (entries.length === 0) return;
    this.sql.exec(
      `UPDATE requests SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
      ...entries.map(([, value]) => value as SqlStorageValue),
      id,
    );
  }

  // Chat timeline

  addChat(entry: Omit<ChatRow, 'seq' | 'actions' | 'options'> & { actions?: string[]; options?: string[] }): number {
    this.sql.exec(
      'INSERT INTO chat (at, kind, request_id, author_key, author_name, text, actions, options) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      entry.at,
      entry.kind,
      entry.request_id,
      entry.author_key,
      entry.author_name,
      entry.text,
      JSON.stringify(entry.actions ?? []),
      JSON.stringify(entry.options ?? []),
    );
    return (this.one<{ seq: number }>('SELECT last_insert_rowid() AS seq')?.seq ?? 0) as number;
  }

  /** Decisions are only offered on the newest entry that offered them. */
  clearChatActions(): void {
    this.sql.exec("UPDATE chat SET actions = '[]' WHERE actions <> '[]'");
  }

  chat(after: number, limit: number): ChatRow[] {
    return this.all<ChatRow>('SELECT * FROM chat WHERE seq > ? ORDER BY seq LIMIT ?', after, limit);
  }

  lastChatSeq(): number {
    return (this.one<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM chat')?.seq ?? 0) as number;
  }

  // Releases

  addRelease(release: ReleaseRow): void {
    const columns = Object.keys(release);
    this.sql.exec(
      `INSERT INTO releases (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      ...columns.map((column) => release[column as keyof ReleaseRow] as SqlStorageValue),
    );
  }

  updateRelease(id: string, fields: Partial<Omit<ReleaseRow, 'id'>>): void {
    const entries = Object.entries(fields);
    if (entries.length === 0) return;
    this.sql.exec(
      `UPDATE releases SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
      ...entries.map(([, value]) => value as SqlStorageValue),
      id,
    );
  }

  releases(limit = 10): ReleaseRow[] {
    return this.all<ReleaseRow>('SELECT * FROM releases ORDER BY rowid DESC LIMIT ?', limit);
  }

  deployingReleases(): ReleaseRow[] {
    return this.all<ReleaseRow>("SELECT * FROM releases WHERE status = 'deploying' ORDER BY rowid");
  }
}
