// Builds: the GitHub Actions runs that deploy a project, and their logs, read with the instance's App.
import { GithubClient } from '@bohr/github';
import type { Db, Project } from '../db/client';
import { deps } from '../deps';
import type { Env } from '../env';
import { repositoryToken } from './github-app';

export type Build = {
  id: number;
  number: number | null;
  workflow: string | null;
  title: string | null;
  branch: string | null;
  commit: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type BuildJob = {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  steps: { number: number; name: string; status: string | null; conclusion: string | null }[];
  /** The job's log (the last part when long), timestamps kept. */
  log: string;
};

/** Logs above this are cut from the start: the end is where builds fail. */
const MAX_LOG_CHARS = 200_000;

async function github(db: Db, env: Env, project: Project) {
  return new GithubClient({ token: (await repositoryToken(db, env, project, 'worker')).token, fetch: deps.fetch });
}

export async function listBuilds(db: Db, env: Env, project: Project): Promise<Build[]> {
  const client = await github(db, env, project);
  const runs = await client.listWorkflowRuns(project.repoOwner, project.repoName, { perPage: 30 });
  return runs
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((run) => ({
      id: run.id,
      number: run.run_number ?? null,
      workflow: run.name,
      title: run.display_title ?? null,
      branch: run.head_branch,
      commit: run.head_sha,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      url: run.html_url,
    }));
}

export async function buildJobs(db: Db, env: Env, project: Project, runId: number): Promise<BuildJob[]> {
  const client = await github(db, env, project);
  const jobs = await client.listRunJobs(project.repoOwner, project.repoName, runId);
  return Promise.all(
    jobs.map(async (job) => {
      const log = job.started_at === null ? '' : await client.getJobLogs(project.repoOwner, project.repoName, job.id);
      return {
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        url: job.html_url,
        steps: job.steps,
        log: log.length > MAX_LOG_CHARS ? `…\n${log.slice(-MAX_LOG_CHARS)}` : log,
      };
    }),
  );
}
