/** Lambda Function URL request event (payload format version 2.0). */
export interface LambdaFunctionUrlEvent {
  version: '2.0';
  routeKey: '$default';
  rawPath: string;
  rawQueryString: string;
  /** Absent when the request has no Cookie header. */
  cookies?: string[];
  /** Lowercased names; the Cookie header is moved to `cookies`. */
  headers: Record<string, string>;
  /** Repeated keys joined with ","; absent when there is no query string. */
  queryStringParameters?: Record<string, string>;
  requestContext: LambdaFunctionUrlRequestContext;
  /** Absent when the request has no body. */
  body?: string;
  pathParameters?: undefined;
  isBase64Encoded: boolean;
  stageVariables?: undefined;
}

export interface LambdaFunctionUrlRequestContext {
  accountId: string;
  apiId: string;
  domainName: string;
  domainPrefix: string;
  http: {
    method: string;
    path: string;
    protocol: string;
    sourceIp: string;
    userAgent: string;
  };
  requestId: string;
  routeKey: string;
  stage: string;
  /** dd/MMM/yyyy:HH:mm:ss +0000 */
  time: string;
  timeEpoch: number;
}

type HeaderValue = string | number | boolean;

/** Structured result. Any other output (or one without statusCode) is sent as a JSON body. */
export interface LambdaResult {
  statusCode: number | string;
  headers?: Record<string, HeaderValue | HeaderValue[] | null | undefined>;
  multiValueHeaders?: Record<string, HeaderValue[] | null | undefined>;
  /** Each entry becomes a Set-Cookie header. */
  cookies?: string[];
  /** Strings are sent as is; anything else is sent as JSON. */
  body?: unknown;
  isBase64Encoded?: boolean;
}

/** The Lambda context object; compatible with `Context` from @types/aws-lambda. */
export interface LambdaContext {
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  /** Kept for compatibility; Workers have no event loop to wait for. */
  callbackWaitsForEmptyEventLoop: boolean;
  getRemainingTimeInMillis(): number;
  /** Legacy completion methods; the first completion of any kind wins. */
  done(error?: unknown, result?: unknown): void;
  succeed(result?: unknown): void;
  fail(error?: unknown): void;
}

export type LambdaCallback = (error?: unknown, result?: unknown) => void;

/** An async handler, or a callback-style one that receives `callback` as its third argument. */
export type LambdaHandler = (
  event: LambdaFunctionUrlEvent,
  context: LambdaContext,
  callback: LambdaCallback,
) => unknown;
