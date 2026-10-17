// The project's own build, from .bohr/deploy.json, run where the CLI runs (the person's machine, an agent's sandbox
// or CI) before deploying: the same install and build commands bohr's deploy workflow runs
import { spawn } from 'node:child_process';
import type { DeployConfig } from '@bohr/shared';
import { CliError } from './errors';
import type { Logger } from './log';

/** Runs a shell command line (in `env` when given, else the CLI's own environment) and resolves with its exit code. */
export type ShellRunner = (commandLine: string, cwd: string, env?: NodeJS.ProcessEnv) => Promise<number>;

/** Output goes to stderr: stdout only carries the command's result (a URL, or the JSON of --json). */
export const runShell: ShellRunner = (commandLine, cwd, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(commandLine, { cwd, env: env ?? process.env, shell: true, stdio: ['inherit', 2, 2] });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });

/** Installs and builds as the deploy workflow does; a failing step stops the deploy before anything is uploaded. */
export async function runBuild(
  config: DeployConfig,
  directory: string,
  logger: Logger,
  options: { run?: ShellRunner; env?: NodeJS.ProcessEnv; nodeVersion?: string } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const major = (options.nodeVersion ?? process.versions.node).split('.')[0];
  if (major !== config.node) {
    logger.warning(`The project builds with Node.js ${config.node} (.bohr/deploy.json); this is Node.js ${major}.`);
  }
  const missing = config.secrets.filter((name) => env[name] === undefined);
  if (missing.length > 0) {
    logger.warning(
      `The build expects ${missing.join(', ')} (secrets in .bohr/deploy.json), which this environment does not set.`,
    );
  }
  const run = options.run ?? runShell;
  for (const [step, commandLine] of [
    ['Install', config.install],
    ['Build', config.build],
  ] as const) {
    if (commandLine === undefined) continue;
    await logger.group(`${step}: ${commandLine}`, async () => {
      let code: number;
      try {
        code = await run(commandLine, directory, options.env);
      } catch (error) {
        throw new CliError(`Could not run "${commandLine}": ${(error as Error).message}`);
      }
      if (code !== 0) {
        throw new CliError(`${step} failed ("${commandLine}" exited with code ${code}). Nothing was deployed.`);
      }
    });
  }
}
