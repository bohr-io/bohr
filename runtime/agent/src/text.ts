/** Cuts text to at most `max` characters, ending with an ellipsis when something was cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - 1);
  // Never leave half of a surrogate pair behind.
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${text.slice(0, end)}…`;
}

/** Keeps the end of a text (the most recent log lines), at most `max` characters. */
export function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  let start = text.length - max + 1;
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) start++;
  return `…${text.slice(start)}`;
}

/** Collapses whitespace, including newlines, into single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Message of an error, including the cause undici attaches to "fetch failed". */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message} (${cause.message})`;
  }
  return error.message;
}

/** Removes terminal colors and other control characters (except tabs) from process output. */
export function stripControl(text: string): string {
  return text.replace(/\p{Cc}\[[0-9;?]*[ -/]*[@-~]/gu, '').replace(/[^\P{Cc}\t]/gu, '');
}
