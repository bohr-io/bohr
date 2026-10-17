// Which screen of the onboarding wizard to show, from GET /api/onboarding's `step`. The onboarding is only
// what every user must set up (the bohr.io Cloud subscription, the Cloudflare account and the GitHub App);
// projects are created afterwards on the "new project" page and the agent is set up in the account settings.
import type { Onboarding, OnboardingStep } from '../api';

/** The screen to show; 'done' is the summary that leads to the first project. */
export type WizardView = OnboardingStep;

/** Groups of steps in the progress indicator. */
export type WizardPhase = 'subscription' | 'cloudflare' | 'github';

export interface WizardLocal {
  /** Paste another Cloudflare token instead of picking one of the pending accounts. */
  pasteNewToken: boolean;
}

export const EMPTY_LOCAL: WizardLocal = { pasteNewToken: false };

export function wizardView(onboarding: Pick<Onboarding, 'step'>, local: WizardLocal): WizardView {
  if (onboarding.step === 'cloudflare_account' && local.pasteNewToken) return 'cloudflare';
  return onboarding.step;
}

/** The phases this user goes through: the subscription only on bohr.io Cloud (an instance with billing). */
export function wizardPhases(onboarding: Pick<Onboarding, 'billing'>): WizardPhase[] {
  const phases: WizardPhase[] = onboarding.billing.enabled ? ['subscription'] : [];
  phases.push('cloudflare', 'github');
  return phases;
}

const PHASE_OF: Record<WizardView, WizardPhase | null> = {
  subscription: 'subscription',
  cloudflare: 'cloudflare',
  cloudflare_account: 'cloudflare',
  github: 'github',
  done: null,
};

/** The current phase, or null when every phase is done. */
export function phaseOf(view: WizardView): WizardPhase | null {
  return PHASE_OF[view];
}
