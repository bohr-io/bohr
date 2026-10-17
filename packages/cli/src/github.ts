// The part of GitHub Actions' runner protocol the CLI uses, written the way @actions/core 3 writes it (the
// deploy action used that package; test/github.test.ts compares the two): inputs from INPUT_<NAME>, outputs and
// environment through the $GITHUB_OUTPUT and $GITHUB_ENV files, workflow commands (::add-mask::, ::group::,
// ::warning::…) on stdout, the OIDC token from ACTIONS_ID_TOKEN_REQUEST_URL and the job summary.
import { randomUUID } from 'node:crypto';
import { appendFileSync, constants, existsSync } from 'node:fs';
import { access, appendFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { type Fetch, fetchWithRetry, type Sleep } from './http';
import type { Logger } from './log';

/** True inside a GitHub Actions job. */
export function inGithubActions(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GITHUB_ACTIONS === 'true';
}

/** True when the job may request an OIDC token (`permissions: id-token: write`). */
export function hasOidc(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

/** An action input (`with:`), trimmed; empty when unset. */
export function getInput(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '').trim();
}

/** `::command key=value::message`, escaped like @actions/core. */
export function command(name: string, properties: Record<string, string>, message: string): string {
  const props = Object.entries(properties)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${escapeProperty(value)}`)
    .join(',');
  return `::${name}${props ? ` ${props}` : ''}::${escapeData(message)}`;
}

function issue(name: string, message = '', properties: Record<string, string> = {}): void {
  process.stdout.write(command(name, properties, message) + EOL);
}

function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** `name<<delimiter` + value + delimiter, the multi-line form of $GITHUB_OUTPUT and $GITHUB_ENV. */
export function keyValueMessage(name: string, value: string): string {
  const delimiter = `ghadelimiter_${randomUUID()}`;
  if (name.includes(delimiter))
    throw new Error(`Unexpected input: name should not contain the delimiter "${delimiter}"`);
  if (value.includes(delimiter)) {
    throw new Error(`Unexpected input: value should not contain the delimiter "${delimiter}"`);
  }
  return `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}`;
}

function fileCommand(file: 'OUTPUT' | 'ENV', message: string): void {
  const path = process.env[`GITHUB_${file}`];
  if (!path) throw new Error(`Unable to find environment variable for file command ${file}`);
  if (!existsSync(path)) throw new Error(`Missing file at path: ${path}`);
  appendFileSync(path, `${message}${EOL}`, { encoding: 'utf8' });
}

/** Sets an output of the current step. */
export function setOutput(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) {
    fileCommand('OUTPUT', keyValueMessage(name, value));
    return;
  }
  process.stdout.write(EOL);
  issue('set-output', value, { name });
}

/** Sets an environment variable for this process and the next steps of the job. */
export function exportVariable(name: string, value: string): void {
  process.env[name] = value;
  if (process.env.GITHUB_ENV) {
    fileCommand('ENV', keyValueMessage(name, value));
    return;
  }
  issue('set-env', value, { name });
}

/** Masks a value in every later line of the job log. */
export function setSecret(secret: string): void {
  issue('add-mask', secret);
}

export function info(message: string): void {
  process.stdout.write(message + EOL);
}

export function warning(message: string): void {
  issue('warning', message);
}

export function debug(message: string): void {
  issue('debug', message);
}

/** Marks the step as failed: an error annotation, and exit code 1. */
export function setFailed(message: string): void {
  process.exitCode = 1;
  issue('error', message);
}

export async function group<T>(name: string, fn: () => Promise<T>): Promise<T> {
  issue('group', name);
  try {
    return await fn();
  } finally {
    issue('endgroup');
  }
}

/** The job log, with groups and masks. */
export const actionsLogger: Logger = { info, warning, setSecret, group };

/**
 * A GitHub OIDC token for `audience`, from the runner's token service (the job needs `id-token: write`). Masked
 * once received. Errors start with "Error message:", as @actions/core's do.
 */
export async function getIdToken(
  audience: string,
  options: { fetch?: Fetch; sleep?: Sleep; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  try {
    const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
    if (!requestUrl) throw new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable');
    const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!requestToken) throw new Error('Unable to get ACTIONS_ID_TOKEN_REQUEST_TOKEN env variable');
    const url = `${requestUrl}&audience=${encodeURIComponent(audience)}`;
    debug(`ID token url is ${url}`);
    let response: Response;
    try {
      response = await fetchWithRetry(
        url,
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${requestToken}`,
            'User-Agent': 'actions/oidc-client',
          },
        },
        { fetch: options.fetch ?? globalThis.fetch, sleep: options.sleep },
      );
    } catch (error) {
      throw new Error(`Failed to get ID Token. Error Code : undefined Error Message: ${(error as Error).message}`);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Failed to get ID Token. Error Code : ${response.status} Error Message: ${text.slice(0, 300)}`);
    }
    let value: unknown;
    try {
      value = (JSON.parse(text) as { value?: unknown }).value;
    } catch {
      value = undefined;
    }
    if (typeof value !== 'string' || value === '') throw new Error('Response json body do not have ID Token field');
    setSecret(value);
    return value;
  } catch (error) {
    throw new Error(`Error message: ${(error as Error).message}`);
  }
}

/** A table cell of the job summary; header cells are <th>. */
export type SummaryCell = string | { data: string; header?: boolean };

/** The job summary as @actions/core's summary builds it: a heading, raw HTML and tables, one per line. */
export class Summary {
  private buffer = '';

  addHeading(text: string, level: number): this {
    const tag = level >= 1 && level <= 6 ? `h${level}` : 'h1';
    return this.addRaw(wrap(tag, text), true);
  }

  addRaw(text: string, addEol = false): this {
    this.buffer += text + (addEol ? EOL : '');
    return this;
  }

  addTable(rows: SummaryCell[][]): this {
    const body = rows
      .map((row) =>
        wrap(
          'tr',
          row
            .map((cell) => (typeof cell === 'string' ? wrap('td', cell) : wrap(cell.header ? 'th' : 'td', cell.data)))
            .join(''),
        ),
      )
      .join('');
    return this.addRaw(wrap('table', body), true);
  }

  toString(): string {
    return this.buffer;
  }

  /** Appends to $GITHUB_STEP_SUMMARY. */
  async write(): Promise<void> {
    const path = process.env.GITHUB_STEP_SUMMARY;
    if (!path) {
      throw new Error(
        'Unable to find environment variable for $GITHUB_STEP_SUMMARY. Check if your runtime environment supports job summaries.',
      );
    }
    try {
      await access(path, constants.R_OK | constants.W_OK);
    } catch {
      throw new Error(
        `Unable to access summary file: '${path}'. Check if the file has correct read/write permissions.`,
      );
    }
    await appendFile(path, this.buffer, { encoding: 'utf8' });
    this.buffer = '';
  }
}

function wrap(tag: string, content: string): string {
  return content ? `<${tag}>${content}</${tag}>` : `<${tag}>`;
}
