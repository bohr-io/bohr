import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { commitMessage } from '../src/job';
import { buildSystemPrompt, buildUserPrompt, NOTES } from '../src/prompt';
import { makeJob } from './helpers';

describe('buildSystemPrompt', () => {
  it('explains the workspace, branches, preview and how to talk to the user', () => {
    const prompt = buildSystemPrompt(makeJob({ locale: 'pt-BR' }), '/workspace/repo');
    expect(prompt).toContain('You are the bohr agent');
    expect(prompt).toContain('acme/site is checked out at /workspace/repo, on branch homolog');
    expect(prompt).toContain('Production is main');
    expect(prompt).toContain('Do not push');
    expect(prompt).toContain('.bohr/preview.json');
    expect(prompt).toContain('server.allowedHosts: true');
    expect(prompt).toContain('ask_user');
    expect(prompt).toContain('in Brazilian Portuguese');
    // Progress lines come from tool calls (a command's description, the task list), so those follow the language
    expect(prompt).toContain(
      'write the description of each command you run, the activeForm of your task list items and the descriptions of the tasks you delegate in Brazilian Portuguese too',
    );
    expect(prompt).toContain('Never mention costs, prices, tokens, budgets or spending limits');
    expect(prompt).toContain("Never write the preview's address (URL) for the user");
    expect(prompt).not.toContain('prepare the repository for bohr');
  });

  it('adds the import instructions and the project context when present', () => {
    const prompt = buildSystemPrompt(
      makeJob({
        kind: 'import',
        locale: 'es',
        context: {
          projectName: 'Acme\nSite',
          productionUrl: 'https://acme.example',
          previewUrl: 'https://homolog.acme.example',
          requesterName: 'Ada',
        },
      }),
      '/workspace/repo',
    );
    expect(prompt).toContain('prepare the repository for bohr');
    expect(prompt).toContain('.bohr/deploy.json');
    expect(prompt).toContain('wrangler.jsonc');
    expect(prompt).toContain('in Spanish');
    expect(prompt).toContain('- Project name: Acme Site');
    expect(prompt).toContain('- Production URL: https://acme.example');
    expect(prompt).toContain(
      '- Preview URL (configuration only, never in messages to the user): https://homolog.acme.example',
    );
    expect(prompt).toContain('- Requested by: Ada');
  });

  const importJob = (deployTarget?: 'wrangler' | 'bohr-cloud') =>
    makeJob({ kind: 'import', context: { deployTarget } });

  it('describes .bohr/deploy.json, the deploy command, its credentials and the D1 migrations by default', () => {
    for (const deployTarget of [undefined, 'wrangler'] as const) {
      const prompt = buildSystemPrompt(importJob(deployTarget), '/workspace/repo');
      expect(prompt).toContain('Create or fix .bohr/deploy.json so production builds and deploys.');
      expect(prompt).toContain('a GitHub Actions workflow it writes itself (.github/workflows/bohr-deploy.yml)');
      expect(prompt).toContain('"deploy": "<deploys the build, default npx wrangler deploy>"');
      expect(prompt).toContain(
        "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, which the workflow gets from bohr with the run's GitHub OIDC token, only on pushes to main",
      );
      expect(prompt).toContain('they are not repository secrets');
      expect(prompt).toContain('every D1 database in the wrangler config that declares a migrations_dir');
      expect(prompt).toContain('add a new migration file to that folder; never edit');
      expect(prompt).toContain('You cannot change files under .github/workflows');
      expect(prompt).not.toContain('bohr-io/deploy-action');
    }
  });

  it('deploys managed projects with the bohr.io Cloud action, without Cloudflare credentials', () => {
    const prompt = buildSystemPrompt(importJob('bohr-cloud'), '/workspace/repo');
    expect(prompt).toContain('bohr-io/deploy-action uploads the Worker and assets');
    expect(prompt).toContain('it needs no Cloudflare credentials');
    expect(prompt).not.toContain('"deploy":');
    expect(prompt).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(prompt).not.toContain('migrations_dir');
  });

  it('keeps the deploy file in mind on change requests, without the import steps', () => {
    const prompt = buildSystemPrompt(makeJob({ context: { deployTarget: 'bohr-cloud' } }), '/workspace/repo');
    expect(prompt).toContain('Keep .bohr/deploy.json working whenever your change affects the build.');
    expect(prompt).toContain('bohr only replaces a .github/workflows/bohr-deploy.yml it wrote itself');
    expect(prompt).not.toContain('Create or fix .bohr/deploy.json');
    expect(prompt).not.toContain('How projects map to Cloudflare');
  });

  it('maps stacks to Cloudflare on import, and asks before moving code to Queues or R2', () => {
    const prompt = buildSystemPrompt(importJob(), '/workspace/repo');
    expect(prompt).toContain('How projects map to Cloudflare');
    expect(prompt).toContain('A Container behind a Worker');
    expect(prompt).toContain('Neon in the team');
    expect(prompt).toContain('use ask_user and wait for the team');
  });

  it('never names the underlying product', () => {
    for (const kind of ['import', 'change'] as const) {
      expect(buildSystemPrompt(makeJob({ kind }), '/workspace/repo')).not.toMatch(/claude code/i);
    }
    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      for (const key of ['failedError', 'cancelled', 'using', 'publishing'] as const) {
        expect(t(locale, key, { tool: 'X' })).not.toMatch(/claude/i);
      }
    }
  });
});

describe('buildUserPrompt', () => {
  it('is the request itself, with bohr notes in front when there are any', () => {
    const job = makeJob({ prompt: 'Make it darker' });
    expect(buildUserPrompt(job, [])).toBe('Make it darker');
    expect(buildUserPrompt(job, [NOTES.conversationLost(job)])).toBe(
      `[bohr] ${NOTES.conversationLost(job)}\n\nMake it darker`,
    );
  });
});

describe('commitMessage', () => {
  it('takes the first line of the summary as the title and the rest as the body', () => {
    expect(commitMessage('Blue header\n\n- The header is blue\n- Links are white')).toEqual({
      title: 'Blue header',
      body: '- The header is blue\n- Links are white',
    });
  });

  it('strips markdown from the title and keeps it within 72 characters', () => {
    expect(commitMessage('## **New** `contact` page').title).toBe('New contact page');
    expect(commitMessage('\n\n- Changed the footer').title).toBe('Changed the footer');
    const long = commitMessage('A'.repeat(100)).title;
    expect(long).toHaveLength(72);
    expect(long.endsWith('…')).toBe(true);
  });

  it('falls back to a generic title', () => {
    expect(commitMessage('')).toEqual({ title: 'bohr: update' });
    expect(commitMessage('  \n - \n')).toEqual({ title: 'bohr: update' });
  });
});
