import { createRequire } from 'node:module';
import { ClaudeLogin, resolveClaudeBinary } from '@bohr/agent/claude-login';
import { consoleLogger as log } from '@bohr/agent/log';
import { errorMessage } from '@bohr/agent/text';
import { AGENT_PORT } from '@bohr/shared';
import { version } from '../package.json';
import { createLoginServer } from './server';

const port = Number(process.env.BOHR_AGENT_PORT ?? AGENT_PORT);

// The image installs only the CLI's native package, not the whole Agent SDK: it is found from here, the way the
// SDK finds it (@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]/claude)
const resolve = createRequire(import.meta.url).resolve;
const logins = new ClaudeLogin({ log, cliPath: () => resolveClaudeBinary({ resolve }) });

const server = createLoginServer({ version, logins, log, maxBodyBytes: 64 * 1024 });
server.listen(port, '0.0.0.0', () => log.info('bohr sign-in server listening', { version, port }));

process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { error: errorMessage(reason) }));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  server.close();
  // Ends a sign-in in progress and deletes its temporary HOME
  await logins.stop();
  process.exit(0);
}
process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
