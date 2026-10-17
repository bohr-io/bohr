import { sha256Hex } from './crypto';

const MAX_SLUG = 40;
const MAX_LABEL = 63;

// Lowercase, accents removed, every run of other characters replaced by "-"
export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fitLabel(label: string, original: string, max: number) {
  if (label.length <= max) return label;
  const hash = (await sha256Hex(original)).slice(0, 8);
  return `${label.slice(0, max - 9).replace(/-+$/, '')}-${hash}`;
}

// "<project id>-<branch slug>", at most 63 chars (docs/managed-hosting.md)
export async function scriptName(projectId: string, branch: string) {
  const slug = slugify(branch) || 'branch';
  if (slug.length <= MAX_SLUG) return `${projectId}-${slug}`;
  const hash = (await sha256Hex(branch)).slice(0, 8);
  return `${projectId}-${slug.slice(0, MAX_SLUG).replace(/-+$/, '')}-${hash}`;
}

// v1 naming: "<repo>-<owner>.<domain>" for the production branch, "<branch>-<repo>-<owner>.<domain>" otherwise
export async function defaultHostname(
  project: { repoOwner: string; repoName: string; productionBranch: string },
  branch: string,
  domain: string,
) {
  const base = `${slugify(project.repoName)}-${slugify(project.repoOwner)}`;
  const label = branch === project.productionBranch ? base : `${slugify(branch) || 'branch'}-${base}`;
  return `${await fitLabel(label, `${branch}/${project.repoName}/${project.repoOwner}`, MAX_LABEL)}.${domain}`;
}

export function isValidHostname(hostname: string) {
  return (
    hostname.length <= 253 &&
    /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(hostname)
  );
}
