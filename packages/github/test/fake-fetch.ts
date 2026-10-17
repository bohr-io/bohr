import type { Fetch } from '../src';

export type FakeReply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> };
export type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** Records every request and answers from `replies` in order; a request past the last reply fails the test. */
export function fakeFetch(...replies: FakeReply[]) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = init?.body;
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      headers,
      body: typeof body === 'string' ? JSON.parse(body) : body,
    });
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${String(input)}`);
    const status = reply.status ?? 200;
    const text = reply.text ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
    return new Response(status === 204 ? null : text, { status, headers: reply.headers });
  }) as Fetch;
  return { calls, fetch };
}

export function call(calls: Call[], index: number): Call {
  const recorded = calls[index];
  if (recorded === undefined) throw new Error(`No request #${index}; ${calls.length} were made`);
  return recorded;
}
