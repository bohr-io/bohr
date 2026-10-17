// Where the CLI keeps the tokens of `bohr login`: credentials.json in the user's config folder, one entry per
// instance URL, readable by the user only. BOHR_TOKEN (agents, scripts, CI) wins over it.
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CliError, EXIT } from './errors';

export const TOKEN_ENV = 'BOHR_TOKEN';
/** API tokens start with it; the instance refuses anything else as a bohr token. */
export const TOKEN_PREFIX = 'bohr_';

export interface StoredLogin {
  token: string;
  user: { id: string; name: string | null; email: string | null };
  /** When `bohr login` stored it (ISO 8601). */
  createdAt: string;
}

interface CredentialsFile {
  version: 1;
  /** By instance URL (normalizeInstanceUrl). */
  instances: Record<string, StoredLogin>;
}

/**
 * The CLI's config folder: $BOHR_CONFIG_DIR, else $XDG_CONFIG_HOME/bohr, else the platform's (%APPDATA%\bohr,
 * ~/Library/Application Support/bohr, ~/.config/bohr).
 */
export function configDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.BOHR_CONFIG_DIR) return env.BOHR_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'bohr');
  if (platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'bohr');
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'bohr');
  return join(homedir(), '.config', 'bohr');
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'credentials.json');
}

async function readCredentials(env: NodeJS.ProcessEnv): Promise<CredentialsFile> {
  let text: string;
  try {
    text = await readFile(credentialsPath(env), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, instances: {} };
    throw error;
  }
  try {
    const parsed = JSON.parse(text) as Partial<CredentialsFile>;
    if (typeof parsed.instances === 'object' && parsed.instances !== null) {
      return { version: 1, instances: parsed.instances };
    }
  } catch {
    // Unreadable: start over, as if signed out
  }
  return { version: 1, instances: {} };
}

/** Writes the file readable by the user only (0600, in a 0700 folder), replacing it in one step. */
async function writeCredentials(env: NodeJS.ProcessEnv, file: CredentialsFile): Promise<void> {
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = credentialsPath(env);
  const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  // An older file keeps its mode across rename on some systems
  await chmod(target, 0o600).catch(() => {});
}

export async function storedLogin(instanceUrl: string, env: NodeJS.ProcessEnv = process.env) {
  return (await readCredentials(env)).instances[instanceUrl] ?? null;
}

export async function saveLogin(instanceUrl: string, login: StoredLogin, env: NodeJS.ProcessEnv = process.env) {
  const file = await readCredentials(env);
  file.instances[instanceUrl] = login;
  await writeCredentials(env, file);
}

/** Forgets the instance's token; true when there was one. */
export async function removeLogin(instanceUrl: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const file = await readCredentials(env);
  if (file.instances[instanceUrl] === undefined) return false;
  delete file.instances[instanceUrl];
  await writeCredentials(env, file);
  return true;
}

export type TokenSource = 'env' | 'login';

/** The API token to call the instance with: BOHR_TOKEN, else the one `bohr login` stored, else null. */
export async function findToken(
  instanceUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ token: string; source: TokenSource } | null> {
  const fromEnv = env[TOKEN_ENV]?.trim();
  if (fromEnv) {
    if (!fromEnv.startsWith(TOKEN_PREFIX)) {
      throw new CliError(
        `${TOKEN_ENV} is not a bohr token (they start with ${TOKEN_PREFIX}). Create one in the panel: Account › Tokens.`,
        EXIT.auth,
        'invalid_token',
      );
    }
    return { token: fromEnv, source: 'env' };
  }
  const login = await storedLogin(instanceUrl, env);
  return login === null ? null : { token: login.token, source: 'login' };
}

/** Like findToken, but signed out is an error that says how to sign in. */
export async function requireToken(instanceUrl: string, env: NodeJS.ProcessEnv = process.env) {
  const found = await findToken(instanceUrl, env);
  if (found === null) {
    throw new CliError(
      `Not signed in to ${instanceUrl}. Run "bohr login", or set ${TOKEN_ENV} to a token from the panel (Account › Tokens).`,
      EXIT.auth,
      'not_signed_in',
    );
  }
  return found;
}
