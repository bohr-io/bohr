// Status dots (StatusIndicator) and their labels (i18n keys) for projects, previews and releases.
import type { HomologStatus, ReleaseStatus } from '@bohr/shared';
import type { DeployStatus } from '@bohr/ui';
import type { ProjectSummary, RuntimeStatus } from '../api';

export interface Indicator {
  status: DeployStatus;
  /** i18n key of the label. */
  label: string;
}

export function projectIndicator(project: Pick<ProjectSummary, 'status' | 'runtime'>): Indicator {
  if (project.status === 'suspended') return { status: 'error', label: 'projects.state.suspended' };
  if (project.status === 'migrating') return { status: 'warning', label: 'projects.state.migrating' };
  switch (project.runtime?.status) {
    case 'ready':
      return { status: 'success', label: 'projects.state.ready' };
    case 'error':
      return { status: 'error', label: 'projects.state.error' };
    case 'pending':
    case 'provisioning':
      return { status: 'warning', label: 'projects.state.provisioning' };
    default:
      return { status: 'off', label: 'projects.state.deployOnly' };
  }
}

export const HOMOLOG_INDICATORS: Record<HomologStatus, Indicator> = {
  clean: { status: 'off', label: 'homolog.clean' },
  pending: { status: 'warning', label: 'homolog.pending' },
  publishing: { status: 'success', label: 'homolog.publishing' },
};

export const RELEASE_INDICATORS: Record<ReleaseStatus, Indicator> = {
  deploying: { status: 'warning', label: 'versions.status.deploying' },
  live: { status: 'success', label: 'versions.status.live' },
  failed: { status: 'error', label: 'versions.status.failed' },
  rolled_back: { status: 'off', label: 'versions.status.rolledBack' },
};

/** A GitHub Actions run or job, from its status and (once completed) its conclusion. */
export function buildIndicator(status: string | null, conclusion: string | null): Indicator {
  if (status !== 'completed') {
    return status === 'in_progress'
      ? { status: 'warning', label: 'builds.status.running' }
      : { status: 'warning', label: 'builds.status.queued' };
  }
  switch (conclusion) {
    case 'success':
      return { status: 'success', label: 'builds.status.success' };
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return { status: 'error', label: 'builds.status.failure' };
    case 'cancelled':
      return { status: 'off', label: 'builds.status.cancelled' };
    case 'action_required':
      return { status: 'warning', label: 'builds.status.actionRequired' };
    default:
      return { status: 'off', label: 'builds.status.skipped' };
  }
}

/** The badge class of a status. */
export const BADGE_OF: Record<Indicator['status'], string> = {
  success: 'badge--green',
  warning: 'badge--amber',
  error: 'badge--red',
  off: '',
};

/** The admin area's badges: a project's status and its runtime's. */
export const PROJECT_BADGE: Record<ProjectSummary['status'], string> = {
  active: 'badge--green',
  migrating: 'badge--amber',
  suspended: 'badge--red',
};

export const RUNTIME_BADGE: Record<RuntimeStatus, string> = {
  ready: 'badge--green',
  provisioning: 'badge--amber',
  pending: 'badge--amber',
  error: 'badge--red',
};
