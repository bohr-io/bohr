import path from 'node:path';

// Guard rails for the agent's tool calls. The container is the security boundary; these only stop the
// obvious ways to step outside the workflow bohr runs (pushing, rewiring remotes, touching credentials,
// editing CI or writing outside the checkout), with a reason the model can act on.

export const DENY = {
  push: 'bohr commits and pushes your work when you finish. Do not run git push.',
  remotes: 'Changing git remotes is not allowed in this workspace.',
  aliases: 'Git aliases are not allowed in this workspace.',
  credentials: 'Git credentials are managed by bohr. Do not read or change credential helpers.',
  gitConfigFiles: 'Git configuration files are managed by bohr. Do not write to them.',
  gitDir: 'Files inside .git are managed by bohr. Change the project files instead.',
  runner: "That address belongs to bohr's control channel. Leave it alone.",
  workflows:
    'This request may not change GitHub Actions workflows (.github/workflows). Leave them as they are and mention in your summary if they need a change.',
  isolation: 'Run subagents in this checkout, without isolation, so their changes are kept.',
} as const;

export interface GuardContext {
  workspace: string;
  /** Directories outside the workspace the agent may write to, such as /tmp. */
  writableRoots: readonly string[];
  allowWorkflowEdits: boolean;
  /** Directory that relative paths are resolved against; the workspace when absent. */
  cwd?: string;
  /** Path flavor; tests pass path.posix to check container paths on any machine. */
  pathApi?: typeof path;
}

const FILE_TOOLS = new Map([
  ['Edit', 'file_path'],
  ['Write', 'file_path'],
  ['MultiEdit', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
]);

/** Why a tool call must not run, or undefined when it may. */
export function checkToolUse(toolName: string, input: unknown, context: GuardContext): string | undefined {
  const fields = isRecord(input) ? input : {};
  if (toolName === 'Bash') {
    return typeof fields.command === 'string' ? checkBashCommand(fields.command, context) : undefined;
  }
  const pathField = FILE_TOOLS.get(toolName);
  if (pathField) {
    const target = fields[pathField];
    return typeof target === 'string' ? checkFileWrite(target, context) : undefined;
  }
  if ((toolName === 'Agent' || toolName === 'Task') && fields.isolation !== undefined) return DENY.isolation;
  return undefined;
}

/** Checks a file the agent is about to write. */
export function checkFileWrite(file: string, context: GuardContext): string | undefined {
  const p = context.pathApi ?? path;
  const workspace = p.resolve(context.workspace);
  const target = p.resolve(context.cwd ?? workspace, file);
  const inWorkspace = isInside(p, workspace, target);
  if (!inWorkspace) {
    if (context.writableRoots.some((root) => isInside(p, p.resolve(root), target))) return undefined;
    return `Write inside the repository (${context.workspace}) or /tmp only.`;
  }
  const relative = p.relative(workspace, target).split(p.sep).join('/');
  if (relative === '.git' || relative.startsWith('.git/')) return DENY.gitDir;
  if (!context.allowWorkflowEdits && isWorkflowPath(relative)) return DENY.workflows;
  return undefined;
}

/** True for paths (relative to the repository root, with forward slashes) under .github/workflows. */
export function isWorkflowPath(relative: string): boolean {
  const normalized = relative.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  return normalized === '.github/workflows' || normalized.startsWith('.github/workflows/');
}

function isInside(p: typeof path, root: string, target: string): boolean {
  const relative = p.relative(root, target);
  return relative === '' || !(relative === '..' || relative.startsWith(`..${p.sep}`) || p.isAbsolute(relative));
}

const RUNNER_ADDRESS = /\bbohr\.internal\b|(?:^|[^\w.])(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])?:4840\b/i;
const CREDENTIAL_MENTION = /\.git-credentials|credential\.helper|\bgit-credential/i;
const GIT_CONFIG_FILE = /\.gitconfig\b|\.git[\\/]+config\b/i;
const WORKFLOW_DIR = /\.github[\\/]+workflows/i;

/** Checks a shell command line, including commands chained with ;, &&, ||, pipes, subshells and `bash -c`. */
export function checkBashCommand(
  command: string,
  context: Pick<GuardContext, 'allowWorkflowEdits'> = { allowWorkflowEdits: false },
  depth = 0,
): string | undefined {
  if (RUNNER_ADDRESS.test(command)) return DENY.runner;
  if (CREDENTIAL_MENTION.test(command)) return DENY.credentials;
  for (const words of splitCommands(command)) {
    const reason = checkSimpleCommand(words, context, depth);
    if (reason) return reason;
  }
  // Command substitutions inside double quotes stay whole words above; look inside them too.
  if (depth < 3) {
    for (const match of command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) {
      const inner = match[1] ?? match[2];
      const reason = inner ? checkBashCommand(inner, context, depth + 1) : undefined;
      if (reason) return reason;
    }
  }
  if (GIT_CONFIG_FILE.test(command) && writesFiles(command)) return DENY.gitConfigFiles;
  if (!context.allowWorkflowEdits && WORKFLOW_DIR.test(command) && writesFiles(command)) return DENY.workflows;
  return undefined;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
/** Words that run the command after them: `sudo git push`, `if git push; then`, `env A=1 git push`. */
const PREFIXES = new Set([
  'sudo',
  'doas',
  'command',
  'builtin',
  'exec',
  'nohup',
  'time',
  'nice',
  'ionice',
  'xargs',
  'env',
  'stdbuf',
  'timeout',
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
  '!',
  '{',
]);

function checkSimpleCommand(
  words: string[],
  context: Pick<GuardContext, 'allowWorkflowEdits'>,
  depth: number,
): string | undefined {
  const [program, ...args] = stripPrefixes(words);
  if (program === undefined) return undefined;
  const name = commandName(program);
  if (name === 'git') return checkGit(args);
  if (name.startsWith('git-credential')) return DENY.credentials;
  if (depth >= 3) return undefined;
  if (name === 'eval') return checkBashCommand(args.join(' '), context, depth + 1);
  if (SHELLS.has(name)) {
    const flag = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
    const script = flag === -1 ? undefined : args[flag + 1];
    if (script !== undefined) return checkBashCommand(script, context, depth + 1);
  }
  return undefined;
}

function stripPrefixes(words: string[]): string[] {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? '';
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      index++;
      continue;
    }
    if (!PREFIXES.has(commandName(word))) break;
    index++;
    // Options and durations of the prefix itself: `nice -n 5`, `timeout 30`, `xargs -0`.
    while (index < words.length && /^(?:-.*|\d+(?:\.\d+)?[smhd]?)$/.test(words[index] ?? '')) index++;
  }
  return words.slice(index);
}

function commandName(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word;
  return base.replace(/\.exe$/i, '').toLowerCase();
}

/** Git global options that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);
const REMOTE_CHANGES = new Set(['add', 'set-url', 'remove', 'rm', 'rename']);
const CONFIG_READS = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l', 'get', 'list']);

function checkGit(args: string[]): string | undefined {
  const configs: string[] = [];
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? '';
    if (arg === '-c' || arg === '--config-env') {
      configs.push(args[index + 1] ?? '');
      index += 2;
    } else if (arg.startsWith('-c') && arg.length > 2 && !arg.startsWith('--')) {
      configs.push(arg.slice(2));
      index++;
    } else if (arg.startsWith('--config-env=')) {
      configs.push(arg.slice('--config-env='.length));
      index++;
    } else if (GIT_VALUE_OPTIONS.has(arg)) {
      index += 2;
    } else if (arg.startsWith('-')) {
      index++;
    } else {
      break;
    }
  }
  for (const config of configs) {
    const reason = checkConfigKey(config.split('=')[0] ?? '');
    if (reason) return reason;
  }
  const subcommand = args[index];
  const rest = args.slice(index + 1);
  if (subcommand === undefined) return undefined;
  if (['push', 'send-pack', 'http-push'].includes(subcommand)) return DENY.push;
  if (subcommand.startsWith('credential')) return DENY.credentials;
  if (subcommand === 'remote') {
    const action = rest.find((word) => !word.startsWith('-'));
    return action !== undefined && REMOTE_CHANGES.has(action) ? DENY.remotes : undefined;
  }
  if (subcommand === 'config' && !rest.some((word) => CONFIG_READS.has(word))) {
    for (const word of rest) {
      if (word.startsWith('-')) continue;
      const reason = checkConfigKey(word);
      if (reason) return reason;
    }
  }
  return undefined;
}

function checkConfigKey(key: string): string | undefined {
  const normalized = key.toLowerCase();
  if (/^credential(?:\.|$)/.test(normalized)) return DENY.credentials;
  if (/^alias\./.test(normalized)) return DENY.aliases;
  if (/^url\..+\.(?:insteadof|pushinsteadof)$/.test(normalized)) return DENY.remotes;
  if (/^remote\..+\.(?:url|pushurl)$/.test(normalized)) return DENY.remotes;
  return undefined;
}

/** A rough "this command line changes files" test, used together with a path it mentions. */
function writesFiles(command: string): boolean {
  const withoutHarmless = command.replace(/\d*>>?\s*\/dev\/null/g, ' ').replace(/\d*>&\d/g, ' ');
  return /(?:^|[^<=-])>|\btee\b|\b(?:sed|perl)\s+(?:-\w*i|--in-place)|\b(?:mv|cp|rm|rmdir|touch|mkdir|ln|install|rsync|truncate|dd|patch|unzip|tar)\s|\bgit\s+(?:mv|rm|checkout|restore|apply|am|stash|cherry-pick|revert|merge|reset|pull)\b|\bcurl\b[^|;&]*\s-\w*o\b|\bwget\b/.test(
    withoutHarmless,
  );
}

/**
 * Splits a shell command line into simple commands (lists of words), following quotes and escapes and
 * breaking at ; & | newlines, parentheses, backticks and $( ). Good enough for a guard rail.
 */
export function splitCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  let index = 0;
  while (index < command.length) {
    const char = command[index] ?? '';
    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      const stop = end === -1 ? command.length : end;
      word += command.slice(index + 1, stop);
      inWord = true;
      index = stop + 1;
    } else if (char === '"') {
      inWord = true;
      index++;
      while (index < command.length && command[index] !== '"') {
        const next = command[index + 1] ?? '';
        if (command[index] === '\\' && '"\\$`'.includes(next) && next !== '') {
          word += next;
          index += 2;
        } else {
          word += command[index];
          index++;
        }
      }
      index++;
    } else if (char === '\\') {
      if (command[index + 1] === '\n') {
        index += 2;
        continue;
      }
      word += command[index + 1] ?? '';
      inWord = true;
      index += 2;
    } else if (char === ' ' || char === '\t') {
      endWord();
      index++;
    } else if (char === '#' && !inWord) {
      const newline = command.indexOf('\n', index);
      index = newline === -1 ? command.length : newline;
    } else if (char === '$' && command[index + 1] === '(') {
      endCommand();
      index += 2;
    } else if (';&|\n\r()`'.includes(char)) {
      endCommand();
      index++;
    } else {
      word += char;
      inWord = true;
      index++;
    }
  }
  endCommand();
  return commands;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
