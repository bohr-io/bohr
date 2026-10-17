import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkBashCommand,
  checkFileWrite,
  checkToolUse,
  DENY,
  type GuardContext,
  isWorkflowPath,
  splitCommands,
} from '../src/guards';

describe('splitCommands', () => {
  it('splits on separators and keeps quoted text together', () => {
    expect(splitCommands(`cd app && git commit -m "fix: don't push" ; echo 'a  b' | wc -c`)).toEqual([
      ['cd', 'app'],
      ['git', 'commit', '-m', "fix: don't push"],
      ['echo', 'a  b'],
      ['wc', '-c'],
    ]);
  });

  it('breaks at subshells, command substitutions and newlines, and skips comments', () => {
    expect(splitCommands('(cd x; git status)\necho $(date) # git push')).toEqual([
      ['cd', 'x'],
      ['git', 'status'],
      ['echo'],
      ['date'],
    ]);
  });

  it('handles escapes and line continuations', () => {
    expect(splitCommands('git \\\n  status && echo a\\ b "q\\"x"')).toEqual([
      ['git', 'status'],
      ['echo', 'a b', 'q"x'],
    ]);
  });
});

describe('checkBashCommand', () => {
  const denied = (command: string) => checkBashCommand(command);

  it.each([
    'git push',
    'git push origin homolog --force',
    'cd app && git push',
    'git -C . push',
    'git -C some/dir push origin',
    'git --git-dir=.git --work-tree . push',
    'git -c user.name=x push',
    'git --no-pager push',
    'GIT_TRACE=1 git push',
    '/usr/bin/git push',
    'sudo git push',
    'env -i PATH=/usr/bin git push',
    'timeout 30 git push',
    'xargs -n 1 git push',
    'nohup git push &',
    'echo ok; git push',
    'npm test || git push',
    '(git push)',
    'if true; then git push; fi',
    'bash -c "git push"',
    "sh -lc 'cd x && git push --force'",
    'eval "git push"',
    'echo "$(git push)"',
    'echo `git push`',
    'git send-pack origin',
  ])('refuses %s', (command) => {
    expect(denied(command)).toBe(DENY.push);
  });

  it.each([
    'git status',
    'git commit -m "do not git push yet"',
    'echo git push',
    'grep -rn "git push" docs/',
    'git log --grep=push',
    'npm run build && npm test',
    'git remote -v',
    'git remote show origin',
    'git remote prune origin',
    'git fetch origin',
    'git config user.name "Ada"',
    'git config --get remote.origin.url',
    'git checkout -- src/App.vue',
    'cat .github/workflows/ci.yml',
    'ls .github/workflows 2>/dev/null',
    'cat .git/config',
    'curl -s http://127.0.0.1:5173/',
  ])('allows %s', (command) => {
    expect(denied(command)).toBeUndefined();
  });

  it.each([
    'git remote add upstream https://github.com/evil/site.git',
    'git remote set-url origin https://example.com/x.git',
    'git remote remove origin',
    'git remote rm origin',
    'git remote rename origin old',
    'git config remote.origin.url https://example.com/x.git',
    'git config remote.origin.pushurl https://example.com/x.git',
    'git config --global url.https://evil.example/.insteadOf https://github.com/',
  ])('refuses remote changes: %s', (command) => {
    expect(denied(command)).toBe(DENY.remotes);
  });

  it.each([
    'git config --global credential.helper store',
    'git -c credential.helper= fetch',
    'cat ~/.git-credentials',
    'git credential fill',
    'git-credential-store get',
    'printf "protocol=https\\nhost=github.com\\n" | git credential-manager get',
  ])('refuses credential access: %s', (command) => {
    expect(denied(command)).toBe(DENY.credentials);
  });

  it('refuses git aliases, which could hide a push', () => {
    expect(denied('git config alias.ship push')).toBe(DENY.aliases);
    expect(denied('git -c alias.p=push p')).toBe(DENY.aliases);
  });

  it.each([
    'curl http://localhost:4840/jobs',
    'curl -X POST http://bohr.internal/v1/agent/events -d @x.json',
    'wget -qO- 127.0.0.1:4840/health',
    'curl "http://[::1]:4840/git/sync"',
  ])('refuses calls to the control channel: %s', (command) => {
    expect(denied(command)).toBe(DENY.runner);
  });

  it('refuses shell writes to git configuration files', () => {
    expect(denied('echo "[user]" >> .git/config')).toBe(DENY.gitConfigFiles);
    expect(denied('cp /tmp/x ~/.gitconfig')).toBe(DENY.gitConfigFiles);
  });

  it('refuses shell writes to workflows unless the job allows them', () => {
    for (const command of [
      'echo "on: push" > .github/workflows/x.yml',
      'rm .github/workflows/ci.yml',
      "sed -i 's/main/homolog/' .github/workflows/ci.yml",
      'mkdir -p .github/workflows && cp /tmp/ci.yml .github/workflows/',
    ]) {
      expect(denied(command), command).toBe(DENY.workflows);
      expect(checkBashCommand(command, { allowWorkflowEdits: true }), command).toBeUndefined();
    }
  });
});

describe('checkFileWrite', () => {
  const context: GuardContext = {
    workspace: '/workspace/repo',
    writableRoots: ['/tmp'],
    allowWorkflowEdits: false,
    pathApi: path.posix,
  };

  it.each([
    '/workspace/repo/src/App.vue',
    'src/App.vue',
    '/workspace/repo/.bohr/preview.json',
    '/workspace/repo/.github/dependabot.yml',
    '/workspace/repo/.github/workflows-notes.md',
    '/tmp/notes.txt',
    '/tmp',
  ])('allows %s', (file) => {
    expect(checkFileWrite(file, context)).toBeUndefined();
  });

  it.each(['/etc/passwd', '/workspace/other/file', '/workspace/repo/../escape.txt', '/root/.bashrc', '/tmpfile'])(
    'refuses %s outside the workspace and /tmp',
    (file) => {
      expect(checkFileWrite(file, context)).toMatch(/^Write inside the repository/);
    },
  );

  it('refuses files inside .git', () => {
    expect(checkFileWrite('/workspace/repo/.git/config', context)).toBe(DENY.gitDir);
    expect(checkFileWrite('/workspace/repo/.git', context)).toBe(DENY.gitDir);
    expect(checkFileWrite('/workspace/repo/.gitignore', context)).toBeUndefined();
  });

  it('refuses workflows unless the job allows them, whatever the case or route', () => {
    for (const file of [
      '/workspace/repo/.github/workflows/ci.yml',
      '/workspace/repo/.GITHUB/Workflows/deploy.yml',
      '.github/workflows/new.yml',
    ]) {
      expect(checkFileWrite(file, context), file).toBe(DENY.workflows);
      expect(checkFileWrite(file, { ...context, allowWorkflowEdits: true }), file).toBeUndefined();
    }
    expect(checkFileWrite('../.github/workflows/x.yml', { ...context, cwd: '/workspace/repo/src' })).toBe(
      DENY.workflows,
    );
  });

  it('works with the paths of the machine it runs on', () => {
    const workspace = path.join(os.tmpdir(), 'bohr-guard', 'repo');
    const native: GuardContext = { workspace, writableRoots: [os.tmpdir()], allowWorkflowEdits: false };
    expect(checkFileWrite(path.join(workspace, 'src', 'main.ts'), native)).toBeUndefined();
    expect(checkFileWrite(path.join(workspace, '.github', 'workflows', 'ci.yml'), native)).toBe(DENY.workflows);
    expect(checkFileWrite(path.join(path.parse(workspace).root, 'elsewhere', 'x.txt'), native)).toMatch(/^Write/);
  });
});

describe('isWorkflowPath', () => {
  it('matches paths under .github/workflows only', () => {
    expect(isWorkflowPath('.github/workflows/ci.yml')).toBe(true);
    expect(isWorkflowPath('./.github/workflows/sub/x.yaml')).toBe(true);
    expect(isWorkflowPath('.github\\workflows\\ci.yml')).toBe(true);
    expect(isWorkflowPath('.github/actions/setup/action.yml')).toBe(false);
    expect(isWorkflowPath('docs/.github/workflows/x.yml')).toBe(false);
  });
});

describe('checkToolUse', () => {
  const context: GuardContext = {
    workspace: '/workspace/repo',
    writableRoots: ['/tmp'],
    allowWorkflowEdits: false,
    pathApi: path.posix,
  };

  it('checks the path of every editing tool', () => {
    const file = '/workspace/repo/.github/workflows/ci.yml';
    expect(checkToolUse('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, context)).toBe(DENY.workflows);
    expect(checkToolUse('Write', { file_path: '/etc/hosts', content: '' }, context)).toMatch(/^Write inside/);
    expect(checkToolUse('MultiEdit', { file_path: file, edits: [] }, context)).toBe(DENY.workflows);
    expect(checkToolUse('NotebookEdit', { notebook_path: '/opt/x.ipynb', new_source: '' }, context)).toMatch(/^Write/);
    expect(checkToolUse('Write', { file_path: '/workspace/repo/index.html', content: '' }, context)).toBeUndefined();
  });

  it('checks shell commands and subagent isolation', () => {
    expect(checkToolUse('Bash', { command: 'git push', description: 'Push' }, context)).toBe(DENY.push);
    expect(checkToolUse('Bash', { command: 'npm run build' }, context)).toBeUndefined();
    expect(checkToolUse('Agent', { description: 'x', prompt: 'y', isolation: 'worktree' }, context)).toBe(
      DENY.isolation,
    );
    expect(checkToolUse('Agent', { description: 'x', prompt: 'y' }, context)).toBeUndefined();
  });

  it('lets reads and malformed input through', () => {
    expect(checkToolUse('Read', { file_path: '/etc/passwd' }, context)).toBeUndefined();
    expect(checkToolUse('Bash', {}, context)).toBeUndefined();
    expect(checkToolUse('Edit', 'nonsense', context)).toBeUndefined();
    expect(checkToolUse('toString', {}, context)).toBeUndefined();
  });
});
