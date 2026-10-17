import { resolve } from 'node:path';
import { prepareBuildPlan } from './build-plan';
import { credentials } from './credentials';
import { type DeployResult, deploy, OIDC_AUDIENCE } from './deploy';
import * as github from './github';
import { formatBytes } from './log';
import { V1_ASSETS_ENV } from './manifest';

export const DEFAULT_INSTANCE_URL = 'https://app.bohr.io';

/**
 * `bohr action`: what bohr-io/deploy-action runs (its dist/index.js starts `npx bohr@latest action`). Reads the
 * action's inputs (INPUT_*), deploys (or only gets the credentials or the build plan), sets the step's outputs
 * and the job summary, exactly as the action did when it bundled this code.
 */
export async function runAction(): Promise<void> {
  const deps = {
    fetch: globalThis.fetch,
    getIdToken: () => github.getIdToken(OIDC_AUDIENCE),
    logger: github.actionsLogger,
  };
  try {
    const credentialsMode = github.getInput('credentials').toLowerCase() === 'true';
    if (github.getInput('build-plan').toLowerCase() === 'true') {
      if (credentialsMode) throw new Error('Set either credentials or build-plan, not both.');
      const phase = github.getInput('phase').toLowerCase() || 'prepare';
      if (phase !== 'prepare') throw new Error(`Unknown phase "${phase}": build-plan only has the "prepare" phase.`);
      await prepareBuildPlan(
        {
          instanceUrl: github.getInput('instance-url') || DEFAULT_INSTANCE_URL,
          workspace: resolve(process.env.GITHUB_WORKSPACE || '.'),
        },
        { ...deps, exportVariable: github.exportVariable, setOutput: github.setOutput },
      );
      return;
    }
    if (credentialsMode) {
      await credentials(
        { instanceUrl: github.getInput('instance-url') || DEFAULT_INSTANCE_URL },
        { ...deps, exportVariable: github.exportVariable, setOutput: github.setOutput },
      );
      return;
    }
    const result = await deploy(
      {
        workingDirectory: resolve(github.getInput('working-directory') || '.'),
        instanceUrl: github.getInput('instance-url') || DEFAULT_INSTANCE_URL,
        commitSha: process.env.GITHUB_SHA || null,
        // Set by the build-plan step of a project migrated from bohr v1, earlier in the same job
        v1Assets: process.env[V1_ASSETS_ENV] === 'true',
      },
      deps,
    );
    github.setOutput('url', result.url);
    github.setOutput('deployment-id', result.deploymentId);
    await writeSummary(result);
  } catch (error) {
    if (error instanceof Error && error.stack) github.debug(error.stack);
    github.setFailed(error instanceof Error ? error.message : String(error));
  }
}

/** The job summary: where the branch was deployed and how many files went up. */
export async function writeSummary(result: DeployResult): Promise<void> {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const url = escapeHtml(result.url);
  const uploaded =
    result.uploadedFiles > 0
      ? `${result.uploadedFiles} (${formatBytes(result.uploadedBytes)})`
      : String(result.uploadedFiles);
  try {
    await new github.Summary()
      .addHeading('bohr.io Cloud deploy', 2)
      .addRaw(`<p>Deployed to <a href="${url}">${url}</a></p>`, true)
      .addTable([
        [
          { data: 'Files', header: true },
          { data: 'Uploaded', header: true },
          { data: 'Bytes', header: true },
          { data: 'Worker modules', header: true },
          { data: 'Deployment', header: true },
        ],
        [
          String(result.assetFiles),
          uploaded,
          formatBytes(result.assetBytes),
          String(result.modules),
          escapeHtml(result.deploymentId),
        ],
      ])
      .write();
  } catch (error) {
    github.warning(`Could not write the job summary: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
