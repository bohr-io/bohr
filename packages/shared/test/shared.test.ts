import { describe, expect, it } from 'vitest';
import {
  AGENT_PORT,
  agentEventBatchSchema,
  agentJobSchema,
  assetsIgnoreFile,
  canTransitionRequest,
  findTemplate,
  hashInviteCode,
  isFinalRequestStatus,
  LOCALES,
  MAX_BUDGET_USD,
  MIN_BUDGET_USD,
  memberKey,
  newInviteCode,
  nextHomologStatus,
  normalizeInviteCode,
  normalizeLocale,
  PROJECT_TEMPLATES,
  previewConfigSchema,
  settingsPatchSchema,
  signBrokerRequest,
  v1Excluded,
  verifyBrokerRequest,
} from '../src/index';

describe('agent contract', () => {
  const job = {
    jobId: 'req_0123456789',
    kind: 'change',
    prompt: 'Make the header blue',
    repo: { owner: 'acme', name: 'site', baseBranch: 'main' },
    author: { name: 'Ada', email: 'ada@example.com' },
    model: 'claude-opus-5-5',
    maxBudgetUsd: 5,
    maxTurns: 200,
    locale: 'pt-BR',
  };

  it('fills defaults for the work branch, workflow edits and context', () => {
    const parsed = agentJobSchema.parse(job);
    expect(parsed.repo.workBranch).toBe('homolog');
    expect(parsed.allowWorkflowEdits).toBe(false);
    expect(parsed.context).toEqual({});
  });

  it('refuses branch names git would reject and unsafe repository names', () => {
    expect(agentJobSchema.safeParse({ ...job, repo: { ...job.repo, baseBranch: 'a..b' } }).success).toBe(false);
    expect(agentJobSchema.safeParse({ ...job, repo: { ...job.repo, baseBranch: '-x' } }).success).toBe(false);
    expect(agentJobSchema.safeParse({ ...job, repo: { ...job.repo, name: '../etc' } }).success).toBe(false);
  });

  it('keeps the runner port out of preview configs', () => {
    expect(previewConfigSchema.safeParse({ command: 'npm run dev', port: AGENT_PORT }).success).toBe(false);
    expect(previewConfigSchema.parse({ command: 'npm run dev', port: 8080 }).port).toBe(8080);
  });

  it('parses event batches', () => {
    const at = new Date().toISOString();
    const batch = agentEventBatchSchema.parse({
      events: [
        { type: 'job.started', jobId: 'req_0123456789', seq: 1, at },
        {
          type: 'job.finished',
          jobId: 'req_0123456789',
          seq: 2,
          at,
          outcome: 'needs_input',
          summary: 'Which color?',
          costUsd: 0.12,
          numTurns: 3,
          question: { text: 'Which blue?', options: ['Navy', 'Sky'] },
        },
      ],
    });
    expect(batch.events[1]).toMatchObject({ commits: [] });
    expect(agentEventBatchSchema.safeParse({ events: [] }).success).toBe(false);
  });
});

describe('project settings', () => {
  it('accepts a budget per request from US$ 0.10 to US$ 1000, the range of the panel and Telegram', () => {
    expect([MIN_BUDGET_USD, MAX_BUDGET_USD]).toEqual([0.1, 1000]);
    expect(settingsPatchSchema.safeParse({ maxBudgetUsd: 0.1 }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ maxBudgetUsd: 1000 }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ maxBudgetUsd: 0.05 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ maxBudgetUsd: 1000.5 }).success).toBe(false);
  });
});

describe('request and preview states', () => {
  it('only allows forward request transitions', () => {
    expect(canTransitionRequest('queued', 'running')).toBe(true);
    expect(canTransitionRequest('running', 'needs_input')).toBe(true);
    expect(canTransitionRequest('succeeded', 'running')).toBe(false);
    expect(isFinalRequestStatus('needs_input')).toBe(true);
    expect(isFinalRequestStatus('running')).toBe(false);
  });

  it('moves the preview through review, publishing and back', () => {
    expect(nextHomologStatus('clean', { type: 'changes_pushed' })).toBe('pending');
    expect(nextHomologStatus('pending', { type: 'approved' })).toBe('publishing');
    expect(nextHomologStatus('publishing', { type: 'changes_pushed' })).toBe('publishing');
    expect(nextHomologStatus('publishing', { type: 'merge_failed' })).toBe('pending');
    expect(nextHomologStatus('publishing', { type: 'merged' })).toBe('clean');
    expect(nextHomologStatus('pending', { type: 'discarded' })).toBe('clean');
    expect(nextHomologStatus('clean', { type: 'approved' })).toBeNull();
    expect(nextHomologStatus('publishing', { type: 'discarded' })).toBeNull();
  });
});

describe('broker signatures', () => {
  const secret = 'project-secret-0123456789abcdef';
  const parts = { method: 'POST', path: '/api/runtime/v1/github-token', body: '{"scope":"sandbox"}' };

  it('verifies a signed call and rejects changed bodies, paths, secrets and stale timestamps', async () => {
    const now = Date.UTC(2026, 9, 11, 12);
    const headers = new Headers(await signBrokerRequest('p123', secret, parts, now));
    expect(headers.get('Bohr-Project')).toBe('p123');
    expect(await verifyBrokerRequest(secret, headers, parts, now)).toBe(true);
    expect(await verifyBrokerRequest(secret, headers, { ...parts, body: '{"scope":"worker"}' }, now)).toBe(false);
    expect(await verifyBrokerRequest(secret, headers, { ...parts, path: '/api/runtime/v1/other' }, now)).toBe(false);
    expect(await verifyBrokerRequest(secret, headers, { ...parts, method: 'GET' }, now)).toBe(false);
    expect(await verifyBrokerRequest('another-secret-0123456789abcdef', headers, parts, now)).toBe(false);
    expect(await verifyBrokerRequest(secret, headers, parts, now + 301_000)).toBe(false);
  });

  it('rejects malformed headers', async () => {
    const headers = new Headers({ 'Bohr-Timestamp': 'soon', 'Bohr-Signature': 'v1=zz' });
    expect(await verifyBrokerRequest(secret, headers, parts)).toBe(false);
    expect(await verifyBrokerRequest(secret, new Headers(), parts)).toBe(false);
  });
});

describe('invites, members and locales', () => {
  it('creates codes that survive retyping', async () => {
    const code = newInviteCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(normalizeInviteCode(code.toLowerCase().replace('-', ' '))).toBe(code);
    expect(normalizeInviteCode('k7p2-9qxo')).toBe('K7P2-9QX0');
    expect(normalizeInviteCode('short')).toBeNull();
    expect(normalizeInviteCode('K7P2-9QXU')).toBeNull();
    expect(await hashInviteCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keys members by Telegram user first', () => {
    expect(memberKey({ telegramUserId: 42, instanceUserId: 'u_1' })).toBe('tg:42');
    expect(memberKey({ instanceUserId: 'u_1' })).toBe('u:u_1');
    expect(() => memberKey({})).toThrow();
  });

  it('maps language tags to supported locales', () => {
    expect(normalizeLocale('pt-br')).toBe('pt-BR');
    expect(normalizeLocale('es-419')).toBe('es');
    expect(normalizeLocale('de')).toBe('en');
    expect(normalizeLocale(undefined, 'pt-BR')).toBe('pt-BR');
  });
});

describe('templates', () => {
  it('lists bohr-io template repositories, named and described in every locale', () => {
    expect(PROJECT_TEMPLATES.map((template) => template.slug)).toEqual([
      'waitlist',
      'booking',
      'link-in-bio',
      'forms',
      'menu',
      'short-links',
    ]);
    for (const template of PROJECT_TEMPLATES) {
      expect(template.repository).toBe(`bohr-io/template-${template.slug}`);
      expect(Object.keys(template.locales).sort()).toEqual([...LOCALES].sort());
      for (const locale of LOCALES) {
        expect(template.locales[locale].name.length, `${template.slug} ${locale}`).toBeGreaterThan(0);
        expect(template.locales[locale].description.length, `${template.slug} ${locale}`).toBeGreaterThan(0);
      }
      for (const tag of template.tags) expect(tag).toMatch(/^[a-z][a-z-]*$/);
    }
    expect(findTemplate('menu')?.repository).toBe('bohr-io/template-menu');
    expect(findTemplate('unknown')).toBeUndefined();
  });
});

describe('assets a moved site never publishes', () => {
  it('lists private files and what bohr v1 never published, from the same rules v1Excluded applies', () => {
    const lines = assetsIgnoreFile().split(String.fromCharCode(10));
    for (const pattern of ['.git', '.env*', 'node_modules', '.github', '.bohr', 'wrangler.json*']) {
      expect(lines, pattern).toContain(pattern);
    }
    for (const pattern of ['.turbo/', '/api/', '/dist-api/', 'package.json', 'yarn.lock', '*.env', '*next.conf.js']) {
      expect(lines, pattern).toContain(pattern);
    }
    expect(v1Excluded('api/handler.js')).toBe(true);
    expect(v1Excluded('apis/kept.js')).toBe(false);
  });
});
