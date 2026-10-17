import { jwtVerify } from 'jose';
import { deps } from '../deps';
import { unauthorized } from './http';

const ISSUER = 'https://token.actions.githubusercontent.com';

export type GithubActionsClaims = {
  repository: string;
  repository_id?: string;
  repository_owner: string;
  ref: string;
  ref_type?: string;
  sha?: string;
  actor?: string;
  run_id?: string;
  /** The event that started the run: push, workflow_dispatch, pull_request… */
  event_name?: string;
  /** The workflow file the job runs, as <owner>/<repo>/<path>@<ref>. */
  job_workflow_ref?: string;
};

// Verifies a GitHub Actions OIDC token (signature, issuer, audience, expiry) and returns the run's claims
export async function verifyGithubOidc(authorization: string | undefined, audience: string) {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (token === undefined) throw unauthorized('Missing GitHub OIDC token.');
  try {
    const { payload } = await jwtVerify(token, deps.githubOidcKeys(), {
      issuer: ISSUER,
      audience,
      algorithms: ['RS256'],
    });
    if (typeof payload.repository !== 'string' || typeof payload.ref !== 'string') {
      throw new Error('Token has no repository or ref.');
    }
    return payload as unknown as GithubActionsClaims;
  } catch (error) {
    console.error('Rejected GitHub OIDC token', error);
    throw unauthorized('Invalid GitHub OIDC token.');
  }
}

export function branchFromRef(ref: string) {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;
}
