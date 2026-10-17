import { describe, expect, it } from 'vitest';
import { createIgnoreMatcher } from '../src/ignore';

const file = (patterns: string[], path: string) => createIgnoreMatcher(patterns)(path, false);
const dir = (patterns: string[], path: string) => createIgnoreMatcher(patterns)(path, true);

describe('createIgnoreMatcher', () => {
  it('skips comments and blank lines', () => {
    const patterns = ['# a comment', '', '   ', '#secret.txt'];
    expect(file(patterns, 'secret.txt')).toBe(false);
    expect(file(patterns, '# a comment')).toBe(false);
  });

  it('matches a name without slashes at any depth', () => {
    expect(file(['*.map'], 'app.js.map')).toBe(true);
    expect(file(['*.map'], 'deep/nested/app.js.map')).toBe(true);
    expect(file(['*.map'], 'app.js')).toBe(false);
    expect(file(['secret.txt'], 'a/b/secret.txt')).toBe(true);
  });

  it('keeps "*" within one path segment', () => {
    expect(file(['docs/*.md'], 'docs/a.md')).toBe(true);
    expect(file(['docs/*.md'], 'docs/sub/a.md')).toBe(false);
    expect(file(['?.txt'], 'a.txt')).toBe(true);
    expect(file(['?.txt'], 'ab.txt')).toBe(false);
  });

  it('anchors patterns with a leading slash to the root', () => {
    expect(file(['/secret.txt'], 'secret.txt')).toBe(true);
    expect(file(['/secret.txt'], 'nested/secret.txt')).toBe(false);
  });

  it('anchors patterns with a slash in the middle', () => {
    expect(file(['config/local.json'], 'config/local.json')).toBe(true);
    expect(file(['config/local.json'], 'app/config/local.json')).toBe(false);
  });

  it('matches directories only for a trailing slash, at any depth', () => {
    expect(dir(['drafts/'], 'drafts')).toBe(true);
    expect(file(['drafts/'], 'drafts')).toBe(false);
    expect(file(['drafts/'], 'drafts/post.html')).toBe(true);
    expect(file(['drafts/'], 'blog/drafts/post.html')).toBe(true);
    expect(file(['/drafts/'], 'blog/drafts/post.html')).toBe(false);
  });

  it('ignores everything inside a directory matched without a trailing slash', () => {
    expect(file(['node_modules'], 'node_modules/pkg/index.js')).toBe(true);
  });

  it('supports "**" at the start, the end and in the middle', () => {
    expect(file(['**/tmp'], 'tmp')).toBe(true);
    expect(file(['**/tmp'], 'a/b/tmp')).toBe(true);
    expect(file(['logs/**'], 'logs/today/app.log')).toBe(true);
    expect(dir(['logs/**'], 'logs')).toBe(false);
    expect(file(['a/**/b.txt'], 'a/b.txt')).toBe(true);
    expect(file(['a/**/b.txt'], 'a/x/y/b.txt')).toBe(true);
    expect(file(['a/**/b.txt'], 'c/a/b.txt')).toBe(false);
    expect(file(['**'], 'anything/at/all')).toBe(true);
  });

  it('re-includes with "!" and lets the last matching rule win', () => {
    const patterns = ['*.map', '!keep.map'];
    expect(file(patterns, 'app.map')).toBe(true);
    expect(file(patterns, 'keep.map')).toBe(false);
    expect(file(['!keep.map', '*.map'], 'keep.map')).toBe(true);
    expect(file(['logs/**', '!logs/keep.txt'], 'logs/keep.txt')).toBe(false);
  });

  it('never re-includes a file inside an ignored directory', () => {
    expect(file(['build/', '!build/keep.js'], 'build/keep.js')).toBe(true);
  });

  it('supports character classes, which never negate (as in the ignore package wrangler uses)', () => {
    expect(file(['file[0-9].txt'], 'file7.txt')).toBe(true);
    expect(file(['file[0-9].txt'], 'fileA.txt')).toBe(false);
    expect(file(['file[!0-9].txt'], 'file7.txt')).toBe(true);
    expect(file(['file[!0-9].txt'], 'file!.txt')).toBe(true);
    expect(file(['file[!0-9].txt'], 'fileA.txt')).toBe(false);
    expect(file(['file[^a].txt'], 'file^.txt')).toBe(true);
    expect(file(['file[^a].txt'], 'fileb.txt')).toBe(false);
    expect(file(['file[z-a7].txt'], 'file7.txt')).toBe(true);
  });

  it('matches case-insensitively, like wrangler', () => {
    expect(file(['*.JS'], 'app.js')).toBe(true);
    expect(file(['img/'], 'IMG/logo.png')).toBe(true);
  });

  it('treats dir/**/ as everything below dir, like wrangler', () => {
    expect(file(['a/**/'], 'a/b.txt')).toBe(true);
    expect(file(['a/**/'], 'a/sub/c.txt')).toBe(true);
    expect(file(['a/**/'], 'b/c.txt')).toBe(false);
  });

  it('honours backslash escapes and trailing whitespace rules', () => {
    expect(file(['\\#notes.txt'], '#notes.txt')).toBe(true);
    expect(file(['\\!important.txt'], '!important.txt')).toBe(true);
    expect(file(['*.log   '], 'debug.log')).toBe(true);
    expect(file(['*.log\r'], 'debug.log')).toBe(true);
    expect(file(['name\\ '], 'name ')).toBe(true);
  });

  it('treats regex characters literally', () => {
    expect(file(['a+b(c).txt'], 'a+b(c).txt')).toBe(true);
    expect(file(['a.txt'], 'abtxt')).toBe(false);
  });
});
