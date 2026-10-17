import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/cache';
import { normalizeHostname, parseRouteRecord, wildcardCandidates } from '../src/routes';

describe('wildcardCandidates', () => {
  it('lists every parent domain down to two labels, most specific first', () => {
    expect(wildcardCandidates('a.b.example.co.uk')).toEqual(['*.b.example.co.uk', '*.example.co.uk', '*.co.uk']);
    expect(wildcardCandidates('www.example.com')).toEqual(['*.example.com']);
  });

  it('never yields a single-label wildcard', () => {
    expect(wildcardCandidates('example.com')).toEqual([]);
    expect(wildcardCandidates('localhost')).toEqual([]);
    expect(wildcardCandidates('a.b.example.co.uk')).not.toContain('*.uk');
  });
});

describe('normalizeHostname', () => {
  it('lowercases and drops the trailing dot', () => {
    expect(normalizeHostname('Site-Acme.Bohr.IO.')).toBe('site-acme.bohr.io');
    expect(normalizeHostname('example.com')).toBe('example.com');
  });
});

describe('parseRouteRecord', () => {
  const specExample = {
    v: 1,
    projectId: 'p3k9x0a7qd2m',
    script: 'p3k9x0a7qd2m-main',
    auth: {
      type: 'basic',
      users: [{ username: 'client', salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 20000 }],
      bypassPaths: ['/health'],
    },
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin' },
    suspended: false,
  };

  it('accepts the record from docs/managed-hosting.md', () => {
    expect(parseRouteRecord(specExample)).toEqual(specExample);
  });

  it('accepts minimal records and null optional fields', () => {
    expect(parseRouteRecord({ v: 1, projectId: 'p1', script: 'p1-main' })).toEqual({
      v: 1,
      projectId: 'p1',
      script: 'p1-main',
      suspended: false,
    });
    expect(parseRouteRecord({ v: 1, projectId: 'p1', script: 's', auth: null, headers: null }).auth).toBeUndefined();
    expect(parseRouteRecord({ v: 1, projectId: 'p1', script: 's', auth: { type: 'none' } }).auth).toEqual({
      type: 'none',
    });
  });

  it.each([
    ['not an object', 'p1'],
    ['an unknown version', { ...specExample, v: 2 }],
    ['a missing script', { ...specExample, script: '' }],
    ['a missing projectId', { ...specExample, projectId: undefined }],
    ['a non-boolean suspended', { ...specExample, suspended: 'yes' }],
    ['an unknown auth type', { ...specExample, auth: { type: 'oauth' } }],
    ['malformed users', { ...specExample, auth: { type: 'basic', users: [{ username: 'client' }] } }],
    ['users that are not a list', { ...specExample, auth: { type: 'basic' } }],
    ['non-string bypassPaths', { ...specExample, auth: { ...specExample.auth, bypassPaths: [1] } }],
    ['an invalid header name', { ...specExample, headers: { 'Bad Header': 'x' } }],
    ['a header value with a line break', { ...specExample, headers: { 'X-Test': 'a\r\nSet-Cookie: x=1' } }],
    ['a non-string header value', { ...specExample, headers: { 'X-Test': 1 } }],
    ['a plain-http movedTo', { ...specExample, movedTo: 'http://store.example.com' }],
    ['a movedTo with a path', { ...specExample, movedTo: 'https://store.example.com/old' }],
    ['a proxyTo outside workers.dev', { ...specExample, proxyTo: 'https://evil.example.com' }],
    ['a plain-http proxyTo', { ...specExample, proxyTo: 'http://api.ana.workers.dev' }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseRouteRecord(value)).toThrow(TypeError);
  });
});

describe('TtlCache', () => {
  it('returns values until they expire', () => {
    const cache = new TtlCache<string | null>();
    cache.set('found', 'record', 30_000, 1_000);
    cache.set('miss', null, 5_000, 1_000);
    expect(cache.get('found', 30_999)).toBe('record');
    expect(cache.get('miss', 5_999)).toBeNull();
    expect(cache.get('miss', 6_000)).toBeUndefined();
    expect(cache.get('found', 31_000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('drops the oldest entry when full', () => {
    const cache = new TtlCache<number>(2);
    cache.set('a', 1, 1_000, 0);
    cache.set('b', 2, 1_000, 0);
    cache.set('a', 3, 1_000, 0); // refreshed, so "b" is now the oldest
    cache.set('c', 4, 1_000, 0);
    expect(cache.size).toBe(2);
    expect(cache.get('b', 0)).toBeUndefined();
    expect(cache.get('a', 0)).toBe(3);
    expect(cache.get('c', 0)).toBe(4);
  });
});
