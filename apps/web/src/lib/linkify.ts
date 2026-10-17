// Chat messages are plain text with URLs in them (preview links, pull requests). They are split into
// text and link segments and rendered as text nodes and anchors, never as HTML.

export type TextSegment = { type: 'text'; text: string } | { type: 'link'; text: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
// Punctuation that ends a sentence rather than the URL.
const TRAILING = /[.,;:!?'")\]}>]+$/;

export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING, '');
    if (url.length <= 'https://'.length) continue;
    if (start > cursor) segments.push({ type: 'text', text: text.slice(cursor, start) });
    segments.push({ type: 'link', text: url, href: url });
    cursor = start + url.length;
  }
  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) });
  return segments;
}
