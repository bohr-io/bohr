// Checks the documentation's sources without building it: both languages have the same pages, every page has a
// title and a description, Portuguese pages link to Portuguese pages, and the downloads shown on their pages match
// the files people download. Links themselves are validated at build time (starlight-links-validator).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EMBEDS, embedded, readEmbed } from './downloads.mjs';

const docs = fileURLToPath(new URL('../src/content/docs/', import.meta.url));

function pages(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => relative(docs, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

const all = pages(docs);
const english = all.filter((page) => !page.startsWith('pt-br/'));
const portuguese = all.filter((page) => page.startsWith('pt-br/')).map((page) => page.slice('pt-br/'.length));

function frontmatter(page) {
  const text = readFileSync(join(docs, page), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text.replaceAll('\r\n', '\n'));
  assert.ok(match, `${page} has no frontmatter`);
  const field = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(match[1])?.[1]?.trim();
  return { title: field('title'), description: field('description'), order: field('  order'), text };
}

test('every page exists in English and in Brazilian Portuguese', () => {
  assert.ok(english.length > 50, `only ${english.length} English pages`);
  assert.deepEqual(portuguese, english);
});

test('every page has a title, a description and the same sidebar order in both languages', () => {
  for (const page of english) {
    const en = frontmatter(page);
    const pt = frontmatter(`pt-br/${page}`);
    for (const [language, data] of [
      ['en', en],
      ['pt-br', pt],
    ]) {
      assert.ok(data.title, `${language} ${page}: title`);
      assert.ok(data.description, `${language} ${page}: description`);
    }
    assert.equal(pt.order, en.order, `${page}: sidebar.order`);
  }
});

test('Portuguese pages link to Portuguese pages', () => {
  for (const page of portuguese) {
    const { text } = frontmatter(`pt-br/${page}`);
    const internal = [...text.matchAll(/\]\((\/[^)\s]*)\)/g)].map((match) => match[1]);
    for (const link of internal) {
      assert.ok(link.startsWith('/pt-br/'), `pt-br/${page} links to ${link}`);
    }
  }
});

test('the pages show the downloads exactly as people download them', () => {
  for (const entry of EMBEDS) {
    const { text, page } = readEmbed(entry);
    assert.ok(page.includes(embedded(text)), `${entry.page} is out of date: run node scripts/downloads.mjs`);
  }
});
