export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

// error_chain: what lies behind a generic error (a DNS record's "DNS Validation Error" says which field)
export type CloudflareMessage = { code: number; message: string; error_chain?: CloudflareMessage[] };

// Pagination details that list endpoints send next to the result
export type ResultInfo = {
  page?: number;
  per_page?: number;
  count?: number;
  total_count?: number;
  total_pages?: number;
  cursor?: string;
};

type Envelope<T> = {
  success: boolean;
  errors?: CloudflareMessage[];
  messages?: CloudflareMessage[];
  result: T;
  result_info?: ResultInfo;
  // The Containers API may answer failures as { error: "CODE" } instead of an errors array
  error?: unknown;
};

export class CloudflareError extends Error {
  constructor(
    readonly status: number,
    readonly errors: CloudflareMessage[],
    readonly path: string,
  ) {
    super(
      `Cloudflare API ${status} on ${path}: ${errors.map((e) => `${e.code} ${e.message}`).join('; ') || 'no details'}`,
    );
    this.name = 'CloudflareError';
  }

  hasCode(code: number) {
    return this.errors.some((error) => error.code === code);
  }
}

// Codes the Workers API uses for a missing script, service or workers.dev subdomain (as wrangler checks them)
const NOT_FOUND_CODES = [10007, 10090, 10092];
// A 404 with these codes means no such route or a bad identifier in the path (often the account), not a missing object
const ROUTING_CODES = [7000, 7003];

export function isNotFoundError(error: unknown): error is CloudflareError {
  if (!(error instanceof CloudflareError)) return false;
  if (NOT_FOUND_CODES.some((code) => error.hasCode(code))) return true;
  return error.status === 404 && !ROUTING_CODES.some((code) => error.hasCode(code));
}

/** Identifies bohr's calls in the accounts it works on (audit logs, support). */
export const DEFAULT_USER_AGENT = 'bohr (+https://bohr.io)';

export type CloudflareClientOptions = {
  apiToken: string;
  accountId: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** e.g. "bohr/2.0.0 (+https://bohr.io)" */
  userAgent?: string;
};

type RequestOptions = {
  json?: unknown;
  form?: FormData;
  body?: BodyInit;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
};

function envelopeErrors(envelope: Envelope<unknown> | undefined): CloudflareMessage[] {
  if (envelope?.errors?.length) return envelope.errors;
  if (typeof envelope?.error === 'string') return [{ code: 0, message: envelope.error }];
  return [];
}

function hasMorePages(info: ResultInfo | undefined, page: number, perPage: number, received: number) {
  if (info === undefined || received === 0) return false;
  if (info.total_count !== undefined) return page * (info.per_page ?? perPage) < info.total_count;
  if (info.total_pages !== undefined) return page < info.total_pages;
  return false;
}

export class CloudflareClient {
  readonly accountId: string;
  readonly userAgent: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: CloudflareClientOptions) {
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? CLOUDFLARE_API;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  get accountPath() {
    return `/accounts/${encodeURIComponent(this.accountId)}`;
  }

  // Calls the API and unwraps the { success, errors, result } envelope
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    return (await this.requestWithInfo<T>(method, path, options)).result;
  }

  // Like request, and also returns the result_info of list endpoints
  async requestWithInfo<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<{ result: T; resultInfo?: ResultInfo }> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      'User-Agent': this.userAgent,
      ...options.headers,
    };
    let body: BodyInit | undefined = options.body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form !== undefined) {
      body = options.form;
    }

    const response = await this.fetchImpl(url.toString(), { method, headers, body });
    let envelope: Envelope<T> | undefined;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      envelope = undefined;
    }
    if (!response.ok || !envelope?.success) {
      throw new CloudflareError(response.status, envelopeErrors(envelope), path);
    }
    return { result: envelope.result, resultInfo: envelope.result_info };
  }

  // Endpoints that answer a file instead of the JSON envelope (a zone's BIND export); failures are still JSON
  async requestText(method: string, path: string): Promise<string> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: { Authorization: `Bearer ${this.apiToken}`, 'User-Agent': this.userAgent },
    });
    const text = await response.text();
    if (!response.ok) {
      let envelope: Envelope<unknown> | undefined;
      try {
        envelope = JSON.parse(text) as Envelope<unknown>;
      } catch {
        envelope = undefined;
      }
      throw new CloudflareError(response.status, envelopeErrors(envelope), path);
    }
    return text;
  }

  // Collects every page of a list endpoint paginated with page/per_page (wrangler's fetchPagedListResult)
  async requestAllPages<T>(path: string, perPage: number, query: RequestOptions['query'] = {}): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const { result, resultInfo } = await this.requestWithInfo<T[] | null>('GET', path, {
        query: { ...query, page, per_page: perPage },
      });
      items.push(...(result ?? []));
      if (!hasMorePages(resultInfo, page, perPage, result?.length ?? 0)) return items;
    }
  }
}
