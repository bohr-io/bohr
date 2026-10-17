// bohr v1's CLI stays on npm (bohr@1.0.577). Repositories still on bohr v1 run `npx bohr@latest deploy` (bohr-io/action's
// fallback, custom workflows, habits): bohr v2's CLI hands those runs to bohr v1's, unchanged, so they keep
// deploying where they always did.
import { spawn } from 'node:child_process';

// Exact: npm's bohr 1.1.x (and 2.x, 3.x) belong to an unrelated 2016 package, so a range like bohr@1 would pick them
export const V1_PACKAGE = 'bohr@1.0.577';
/** Set on the delegated run, so a run never hands itself over twice. */
export const V1_DELEGATED_ENV = 'BOHR_V1_DELEGATED';

/** Thrown by a command that found a bohr v1 repository: the CLI runs bohr v1's CLI with the same arguments. */
export class V1Delegation extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export type RunV1 = (args: string[], env: NodeJS.ProcessEnv) => Promise<number>;

/** `npx --yes bohr@1 <args>` with the terminal and environment of this run; resolves with its exit code. */
export const runV1: RunV1 = (args, env) =>
  new Promise((resolve) => {
    const child = spawn('npx', ['--yes', V1_PACKAGE, ...args], {
      stdio: 'inherit',
      env: { ...env, [V1_DELEGATED_ENV]: '1' },
      // npx is npx.cmd on Windows
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });

export const delegated = (env: NodeJS.ProcessEnv) => env[V1_DELEGATED_ENV] === '1';
