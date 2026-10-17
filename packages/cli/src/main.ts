import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { runAction } from './action';
import { COMMANDS, type Context, GLOBAL_OPTIONS, parseCommandArgs, V1_OPTIONS } from './commands';
import { CliError, EXIT } from './errors';
import * as github from './github';
import { consoleLogger } from './log';
import { delegated, type RunV1, runV1, V1_PACKAGE, V1Delegation } from './v1';
import { CLI_VERSION } from './version';

/** Set by bohr-io/deploy-action's dist/index.js: the step's folder and PATH, as they were before npx ran. */
export const ACTION_CWD_ENV = 'BOHR_ACTION_CWD';
export const ACTION_PATH_ENV = 'BOHR_ACTION_PATH';

/** bohr v1's commands that bohr v2's CLI does not have: bohr v1's CLI runs them. */
const V1_COMMANDS = ['dev', 'version'];

export function helpText(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  return [
    `bohr ${CLI_VERSION}: deploy bohr projects from your terminal, scripts, AI agents and CI.`,
    '',
    'Usage: bohr <command> [options]',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`),
    '',
    'Options for every command:',
    ...optionLines(GLOBAL_OPTIONS),
    '  --version         Print the version',
    '',
    'Authentication: "bohr login" on your computer; BOHR_TOKEN (a token from the panel, Account › Tokens) for',
    "scripts and AI agents; in GitHub Actions without BOHR_TOKEN, the run's OIDC token (permissions: id-token: write).",
    '',
    'Exit codes: 0 done, 1 failed, 2 wrong usage, 3 not signed in or token rejected, 4 project not found or not a',
    'bohr v2 project, 5 not allowed (production without the owner role, projects in your own Cloudflare account).',
    '',
    'Run "bohr <command> --help" for a command\'s options. Docs: https://www.npmjs.com/package/bohr',
  ].join('\n');
}

function commandHelp(name: string): string {
  const command = COMMANDS[name];
  if (command === undefined) return helpText();
  return [
    `bohr ${name}: ${command.summary}`,
    '',
    `Usage: ${command.usage}`,
    '',
    'Options:',
    ...optionLines({ ...command.options, ...GLOBAL_OPTIONS }),
  ].join('\n');
}

function optionLines(options: Record<string, { type: string; short?: string; description: string }>): string[] {
  return Object.entries(options).map(([name, option]) => {
    const flag = `${option.short ? `-${option.short}, ` : ''}--${name}${option.type === 'string' ? ' <value>' : ''}`;
    return `  ${flag.padEnd(22)}${option.description}`;
  });
}

export interface MainIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Overrides for tests (fetch, env, cwd, prompt…). */
  context?: Partial<Context>;
  /** Runs bohr v1's CLI (tests replace it). */
  runV1?: RunV1;
}

const defaultIo: MainIo = {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
};

/** Runs the CLI with `argv` (without node and the script) and resolves with the exit code. */
export async function main(argv: string[], io: MainIo = defaultIo): Promise<number> {
  const [name, ...args] = argv;
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    io.stdout(name === 'help' && args[0] ? commandHelp(args[0]) : helpText());
    return EXIT.ok;
  }
  if (name === '--version' || name === '-v') {
    io.stdout(CLI_VERSION);
    return EXIT.ok;
  }
  if (name === 'action') return runActionCommand();

  const json = args.includes('--json');
  const env = io.context?.env ?? process.env;
  // bohr v1's CLI, with the same arguments; never twice for one run
  const toV1 = (reason: string) => {
    if (delegated(env)) {
      throw new CliError(`bohr v1's CLI (${V1_PACKAGE}) handed this run back (${reason}).`, EXIT.error, 'v1_loop');
    }
    if (!json) io.stderr(`A bohr v1 repository (${reason}): running bohr v1's CLI (${V1_PACKAGE}).`);
    return (io.runV1 ?? runV1)(argv, env);
  };
  try {
    const command = COMMANDS[name];
    if (command === undefined) {
      if (V1_COMMANDS.includes(name)) return await toV1(`"bohr ${name}" is a bohr v1 command`);
      throw new CliError(`Unknown command "${name}". Run "bohr --help" for the commands.`, EXIT.usage, 'usage');
    }
    if (args.includes('--help') || args.includes('-h')) {
      io.stdout(commandHelp(name));
      return EXIT.ok;
    }
    if (name === 'deploy') {
      const v1Option = args.find((arg) => V1_OPTIONS.includes(arg));
      if (v1Option !== undefined) return await toV1(`${v1Option} is an option of bohr v1's deploy`);
    }
    const values = parseCommandArgs(command, args);
    const interactive =
      !json && Boolean(process.stdin.isTTY && process.stderr.isTTY) && !env.CI && env.GITHUB_ACTIONS !== 'true';
    const context: Context = {
      env,
      cwd: process.cwd(),
      fetch: globalThis.fetch,
      // The job log in GitHub Actions (groups, masks), unless stdout carries --json
      logger: github.inGithubActions(env) && !json ? github.actionsLogger : consoleLogger((line) => io.stderr(line)),
      interactive,
      json,
      openUrl,
      prompt,
      ...io.context,
    };
    const result = await command.run(context, values);
    io.stdout(json ? JSON.stringify({ ok: true, ...result.data }) : result.text);
    return EXIT.ok;
  } catch (caught) {
    let error = caught;
    if (error instanceof V1Delegation) {
      try {
        return await toV1(error.reason);
      } catch (loop) {
        error = loop;
      }
    }
    const failure =
      error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error));
    if (json) {
      io.stdout(
        JSON.stringify({
          ok: false,
          error: { code: failure.code, message: failure.message, exitCode: failure.exitCode },
        }),
      );
    } else {
      io.stderr(`Error: ${failure.message}`);
    }
    if (env.BOHR_DEBUG && error instanceof Error && error.stack) io.stderr(error.stack);
    return failure.exitCode;
  }
}

/**
 * `bohr action`, run by bohr-io/deploy-action: back in the step's folder and with its PATH (npx may change both),
 * then the action itself, which reports through the runner (outputs, annotations, exit code).
 */
async function runActionCommand(): Promise<number> {
  const cwd = process.env[ACTION_CWD_ENV];
  if (cwd) process.chdir(cwd);
  const path = process.env[ACTION_PATH_ENV];
  if (path !== undefined) process.env.PATH = path;
  delete process.env[ACTION_CWD_ENV];
  delete process.env[ACTION_PATH_ENV];
  await runAction();
  return typeof process.exitCode === 'number' ? process.exitCode : EXIT.ok;
}

/** Opens a URL in the default browser, without waiting for it. */
async function openUrl(url: string): Promise<void> {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => resolve());
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function prompt(question: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}
