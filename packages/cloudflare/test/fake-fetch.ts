import { CloudflareClient } from '../src';

export type RecordedRequest = {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
  duplex?: string;
};

// Records every request and answers through a router function
export function fakeFetch(handler: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
      body: init?.body,
      duplex: (init as { duplex?: string } | undefined)?.duplex,
    };
    requests.push(request);
    return handler(request);
  }) as typeof fetch;
  return { requests, fetchImpl };
}

export const ok = (result: unknown, resultInfo?: Record<string, number>) =>
  Response.json({ success: true, errors: [], messages: [], result, ...(resultInfo && { result_info: resultInfo }) });

export const fail = (status: number, code: number, message: string) =>
  Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status });

export const notRouted = (request: RecordedRequest) =>
  Response.json(
    { success: false, errors: [{ code: 0, message: `no route for ${request.method} ${request.url}` }] },
    { status: 599 },
  );

export const cloudflare = (fetchImpl: typeof fetch) =>
  new CloudflareClient({ apiToken: 'user-token', accountId: 'acc', fetch: fetchImpl });

// API path of a request, without the /client/v4 prefix
export const apiPath = (request: RecordedRequest) => request.url.pathname.replace('/client/v4', '');

export async function bodyBytes(body: unknown): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
}
