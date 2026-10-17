import { describe, expect, it } from 'vitest';
import type { OnboardingStep } from '../api';
import { onboarding } from '../test-utils';
import { EMPTY_LOCAL, phaseOf, wizardPhases, wizardView } from './wizard';

describe('wizard routing', () => {
  it.each([
    'subscription',
    'cloudflare',
    'cloudflare_account',
    'github',
    'done',
  ] as const satisfies readonly OnboardingStep[])('shows %s as it is', (step) => {
    expect(wizardView({ step }, EMPTY_LOCAL)).toBe(step);
  });

  it('goes back to the token form to paste another Cloudflare token', () => {
    expect(wizardView({ step: 'cloudflare_account' }, { pasteNewToken: true })).toBe('cloudflare');
    expect(wizardView({ step: 'github' }, { pasteNewToken: true })).toBe('github');
  });

  it('lists only the required phases, the subscription only on bohr.io Cloud', () => {
    expect(wizardPhases(onboarding())).toEqual(['cloudflare', 'github']);
    expect(wizardPhases(onboarding({ billing: { enabled: true, subscribed: false } }))).toEqual([
      'subscription',
      'cloudflare',
      'github',
    ]);
    // Subscribed users still see the phase, done.
    expect(wizardPhases(onboarding({ billing: { enabled: true, subscribed: true } }))[0]).toBe('subscription');
  });

  it('groups steps into phases', () => {
    expect(phaseOf('subscription')).toBe('subscription');
    expect(phaseOf('cloudflare_account')).toBe('cloudflare');
    expect(phaseOf('github')).toBe('github');
    expect(phaseOf('done')).toBeNull();
  });
});
