import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Logger } from '../src/log';

export function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bohr-cli-'));
}

/** Writes files given as { 'a/b.txt': contents } below root. */
export async function writeTree(root: string, files: Record<string, string | Uint8Array>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

/** An unsigned JWT carrying the given payload. */
export function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** A successful Cloudflare API envelope. */
export function cloudflareOk(result: unknown): Response {
  return jsonResponse({ success: true, errors: [], messages: [], result });
}

export const noSleep = async (): Promise<void> => {};

/** A Logger that records everything, including secrets, for assertions. */
export function recordingLogger() {
  const lines: string[] = [];
  const secrets: string[] = [];
  const logger: Logger = {
    info: (message) => lines.push(message),
    warning: (message) => lines.push(`warning: ${message}`),
    setSecret: (secret) => secrets.push(secret),
    group: async (name, fn) => {
      lines.push(`group: ${name}`);
      return fn();
    },
  };
  return { logger, lines, secrets };
}

/** A promise with its resolve function exposed. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
