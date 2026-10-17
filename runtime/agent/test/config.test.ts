import { describe, expect, it } from 'vitest';
import { readConfig, remoteUrl } from '../src/config';

describe('readConfig', () => {
  it('defaults to the container layout and bohr.internal', () => {
    expect(readConfig({})).toEqual({
      port: 4840,
      workspace: '/workspace/repo',
      remoteBase: 'https://x-access-token:bohr-placeholder@github.com',
      eventsUrl: 'http://bohr.internal/v1/agent/events',
    });
  });

  it('takes overrides from the environment', () => {
    expect(
      readConfig({
        BOHR_AGENT_PORT: '5000',
        BOHR_WORKSPACE_DIR: '/tmp/ws',
        BOHR_GIT_REMOTE_BASE: 'file:///tmp/remotes',
        BOHR_EVENTS_URL: 'http://127.0.0.1:9000/events',
        BOHR_REPO: 'acme/site.io',
      }),
    ).toEqual({
      port: 5000,
      workspace: '/tmp/ws',
      remoteBase: 'file:///tmp/remotes',
      eventsUrl: 'http://127.0.0.1:9000/events',
      defaultRepo: { owner: 'acme', name: 'site.io' },
    });
  });

  it('refuses malformed values', () => {
    expect(() => readConfig({ BOHR_AGENT_PORT: 'http' })).toThrow(/BOHR_AGENT_PORT/);
    expect(() => readConfig({ BOHR_AGENT_PORT: '70000' })).toThrow(/BOHR_AGENT_PORT/);
    for (const repo of ['acme', 'acme/site/x', '../site', 'acme/..', 'acme/si te']) {
      expect(() => readConfig({ BOHR_REPO: repo }), repo).toThrow(/BOHR_REPO/);
    }
  });
});

describe('remoteUrl', () => {
  it('appends owner and name to the base', () => {
    expect(remoteUrl('https://x-access-token:bohr-placeholder@github.com/', { owner: 'acme', name: 'site' })).toBe(
      'https://x-access-token:bohr-placeholder@github.com/acme/site.git',
    );
    expect(() => remoteUrl('file:///r', { owner: '..', name: 'site' })).toThrow();
  });
});
