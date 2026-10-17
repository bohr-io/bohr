import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { createDb } from '../db/client';
import type { Env } from '../env';
import { ensureMigrated } from '../lib/migrate';
import { applyOwnerAgent } from '../services/agent-settings';
import { notifyProvisioned } from '../services/platform-bot';
import { provisionRuntime, type Step } from '../services/provision';

export type ProvisionParams = { projectId: string; userId: string; locale?: string };

/** Provisions a project runtime step by step; each step is retried and checkpointed by Workflows. */
export class ProvisionWorkflow extends WorkflowEntrypoint<Env, ProvisionParams> {
  override async run(event: Readonly<WorkflowEvent<ProvisionParams>>, step: WorkflowStep): Promise<void> {
    await ensureMigrated(this.env);
    const db = createDb(this.env.DB);
    const { projectId, userId, locale } = event.payload;
    const checkpoint: Step = (name, run) =>
      step.do(
        name,
        { retries: { limit: 3, delay: '15 seconds', backoff: 'exponential' }, timeout: '20 minutes' },
        run as () => Promise<never>,
      );
    try {
      await provisionRuntime(db, this.env, projectId, { locale, step: checkpoint });
      // The owner's agent settings reach the project and the agent prepares the repository. A Worker just
      // deployed may not answer on its workers.dev address for a while: the step is retried before giving up.
      await step
        .do('agent', { retries: { limit: 4, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' }, () =>
          applyOwnerAgent(db, this.env, projectId),
        )
        .catch((error) =>
          console.error(`[provision] could not start the agent: ${error instanceof Error ? error.message : error}`),
        );
      await step.do('notify', async () => {
        await notifyProvisioned(db, this.env, userId, projectId, null);
        return true;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do('notify failure', async () => {
        await notifyProvisioned(db, this.env, userId, projectId, message);
        return true;
      });
    }
  }
}
