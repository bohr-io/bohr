import { PREVIEW_PROXY_PORT } from '@bohr/shared';
import { version } from '../package.json';
import { sdkBackend } from './agent';
import { ClaudeLogin } from './claude-login';
import { readConfig } from './config';
import { EventLog, EventPusher } from './events';
import { JobRunner } from './job';
import { consoleLogger as log } from './log';
import { PreviewManager } from './preview';
import { createPreviewProxy } from './preview-proxy';
import { createRunnerServer } from './server';
import { errorMessage } from './text';

const config = readConfig(process.env);

const events = new EventLog();
const pusher = new EventPusher({ url: config.eventsUrl, log });
events.subscribe((event) => pusher.push(event));

const preview = new PreviewManager({
  workspace: config.workspace,
  log,
  onStatus: (change) => events.emit({ type: 'preview.status', ...change }),
});

const jobs = new JobRunner({
  workspace: config.workspace,
  remoteBase: config.remoteBase,
  defaultRepo: config.defaultRepo,
  events,
  agent: sdkBackend,
  preview,
  log,
});

// Connecting the owner's Claude subscription: the official CLI's `claude setup-token`, one at a time
const logins = new ClaudeLogin({ log });

const server = createRunnerServer({ version, jobs, logins, events, preview, log });
// The project Worker reaches the dev server through this proxy, wherever the dev server listens
createPreviewProxy({
  port: PREVIEW_PROXY_PORT,
  target: () => {
    const state = preview.status();
    return state.status === 'running' ? state.port : undefined;
  },
  log,
});
server.listen(config.port, '0.0.0.0', () => {
  log.info('bohr agent runner listening', { version, port: config.port, workspace: config.workspace });
});
void preview.boot();

// A stray rejection (for example from the agent's process) must not take the whole runner down.
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { error: errorMessage(reason) }));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  server.close();
  await logins.stop();
  const jobId = jobs.currentJobId;
  if (jobId !== undefined) jobs.cancel(jobId);
  await Promise.race([jobs.idle(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  await preview.stop('The workspace is shutting down.');
  await pusher.flush(3000);
  process.exit(0);
}
process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
