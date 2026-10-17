# @bohr/lambda-adapter

Runs AWS Lambda handlers written for Lambda Function URLs on Cloudflare Workers, so bohr v1 projects move to Workers without rewriting `exports.handler`. No runtime dependencies; it only uses Web APIs (Fetch, `URL`, `TextDecoder`, `atob`/`btoa`, `crypto.randomUUID`).

## Migrating a v1 project

In bohr v1 the edge Worker proxied `/api` and `/api/*` to the project's Lambda Function URL. When the site also had static assets, it removed the first `/api` from the path. Sites without assets (or with `useLambda`) sent every path to the Lambda unchanged.

Worker entry (`worker.js`):

```js
import { createLambdaWorker } from '@bohr/lambda-adapter';
import { handler } from './api/core/index.js';

export default createLambdaWorker(handler, {
  match: (url) => url.pathname === '/api' || url.pathname.startsWith('/api/'),
  stripPrefix: '/api',
  cors: 'v1',
});
```

`wrangler.jsonc`:

```jsonc
{
  "name": "my-site",
  "main": "worker.js",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    // "/api/*" does not match the bare "/api", which v1 also sent to the function.
    "run_worker_first": ["/api", "/api/*"]
  }
}
```

Requests to `/api` and `/api/*` reach the Worker first. The handler sees them without the prefix: `/api/users?id=1` arrives as `rawPath: "/users"` and `rawQueryString: "id=1"`, and `/api` arrives as `/`. Only a leading `/api` segment is removed, once: `/api/api/x` becomes `/api/x` and `/apix` is left alone. Every other path is served from the assets, with `index.html` as the single-page-application fallback. If the Worker gets a request that `match` rejects, it is passed to `env.ASSETS`, or answered with 404 when there is no `ASSETS` binding.

For a site without static assets, drop `assets` from `wrangler.jsonc` and send every path to the handler unchanged:

```js
export default createLambdaWorker(handler);
```

Handlers written as CommonJS (`exports.handler = async (event, context) => ...`) can be imported by name as above; wrangler's bundler handles the interop.

v1's Function URLs answered CORS themselves: any `https` origin, with credentials, every method and header, cached for 600 seconds. `cors: 'v1'` keeps that: a preflight (`OPTIONS` with `Access-Control-Request-Method`) from an `https` origin is answered without calling the handler, echoing the requested method and headers, and every response to an `https` origin gets `Access-Control-Allow-Origin: <origin>` and `Access-Control-Allow-Credentials: true`, replacing the `Access-Control-*` headers the handler set (Function URLs did the same). Requests without an `Origin`, or from an `http` origin, are left alone.

Variables and secrets reach the handler through `process.env`. With `nodejs_compat` and a compatibility date on or after 2025-04-01, Workers fill `process.env` at startup, so values read when the module loads work too. The adapter also copies string bindings into `process.env` on the first request (`populateProcessEnv: false` turns that off).

## API

### `createLambdaWorker(handler, options?)`

Returns a Workers module object, `{ fetch(request, env, ctx) }`, for `export default`.

| Option | Default | Meaning |
| --- | --- | --- |
| `match(url)` | every request | Which requests go to the handler. Others go to `env.ASSETS.fetch(request)`, or get a 404 without that binding. |
| `stripPrefix` | none | Path prefix removed once from the start of the path (`"/api"`). |
| `populateProcessEnv` | `true` | Copy string bindings from `env` into `process.env` on the first request, when `process` exists. |
| `functionName` | `"bohr-function"` | `context.functionName`, also used in the ARN and log names. |
| `timeoutMs` | `30000` | Budget reported by `context.getRemainingTimeInMillis()`. Nothing enforces it. |
| `cors` | none | `"v1"` answers CORS the way v1's Function URLs did. See below. |

The handler is called as `handler(event, context, callback)`, following the Node.js Lambda runtime:

- An `async` handler (or one returning a promise) responds with the value it resolves to.
- A callback-style handler responds through `callback(error, result)`, or through the legacy `context.done(error, result)`, `context.succeed(result)` and `context.fail(error)`.
- The first completion wins. A plain synchronous return value is ignored, as on Lambda.
- A thrown error, a rejected promise, a callback error, `context.fail` or an invalid result answers `502` with `{"message":"Internal Server Error"}`. The error is logged with `console.error` and never sent to the client.

`context` carries `functionName`, `functionVersion` (`"$LATEST"`), `invokedFunctionArn` (`arn:aws:lambda:auto:000000000000:function:<functionName>`), `memoryLimitInMB` (`"128"`), `awsRequestId` (a UUID, equal to `event.requestContext.requestId`), `logGroupName` (`/aws/lambda/<functionName>`), `logStreamName`, `getRemainingTimeInMillis()` and `callbackWaitsForEmptyEventLoop`.

### `toLambdaEvent(request, options?)`

Resolves to a Lambda Function URL event (payload format version 2.0), the shape AWS documents. Options: `stripPrefix`, and `requestId` (a random UUID by default).

- `headers`: lowercased names. The `Cookie` header moves to `cookies` (split on `;`). Fetch has already joined repeated headers with `", "`; AWS joins them with `","`. Like a Function URL, the event always has `host`, `x-forwarded-for` (from `CF-Connecting-IP`), `x-forwarded-proto` and `x-forwarded-port`; values the client sent are kept.
- `queryStringParameters`: decoded, with repeated keys joined with `","`. `rawQueryString` keeps the original string.
- `cookies`, `queryStringParameters` and `body` are left out when the request has none, as on AWS. `pathParameters` and `stageVariables` are `undefined`.
- `requestContext`: `accountId` is `"anonymous"` (a Function URL without IAM auth), `apiId` and `domainPrefix` are the first label of the hostname, `http.sourceIp` comes from `CF-Connecting-IP`, `http.protocol` is `"HTTP/1.1"`, and `time` looks like `07/Sep/2021:22:50:22 +0000`.
- `body`: passed as text for `text/*`, `application/json`, `application/xml`, `application/javascript` and `+json`/`+xml` types when it is valid UTF-8. Everything else is base64-encoded with `isBase64Encoded: true`, including form posts, multipart uploads and bodies without a content type.
- Only payload 2.0 fields are present, as on Function URLs. API Gateway v1 fields (`httpMethod`, `path`, `multiValueHeaders`) are absent, so frameworks such as `lambda-api` detect the 2.0 format and read `rawPath` and `requestContext.http.method`.

### `fromLambdaResult(result)`

Turns a handler's output into a `Response` the way a Function URL does.

- An object with a `statusCode` is a structured response. `headers` are applied first, then `multiValueHeaders` (they win for the same name), then each entry of `cookies` becomes its own `Set-Cookie` header. A string `body` is sent as is, or base64-decoded when `isBase64Encoded` is `true`. Any other body is sent as JSON. The content type defaults to `application/json`, as on Function URLs.
- `Content-Length`, `Transfer-Encoding`, `Connection` and `Keep-Alive` set by the handler are dropped; the runtime frames the response. `204`, `205` and `304` responses never carry a body.
- Any other output (a string, an object without `statusCode`, `undefined`) becomes a `200` `application/json` response whose body is that output serialized as JSON. A string is therefore sent quoted: returning the string `Hello, world!` sends the 15-byte body `"Hello, world!"`, as in the AWS documentation's example. Returning nothing sends `null`.
- It throws on a `statusCode` outside 200-599 or a body that is not valid base64. `createLambdaWorker` turns that into a 502.

## Limitations

- **No native addons.** `.node` binaries (`sharp`, `bcrypt`, `canvas`, ...) do not load; use JavaScript or WebAssembly alternatives such as `bcryptjs`.
- **No writable filesystem beyond `/tmp`.** `node:fs` (with `nodejs_compat`, compatibility date 2025-09-01 or later) offers the read-only bundle and an in-memory `/tmp`. Files in `/tmp` exist only for the current request and count toward memory; on Lambda, `/tmp` survived between warm invocations. Files a handler read from disk next to its code (`__dirname`, `/var/task`) must be imported into the bundle instead.
- **128 MB of memory per isolate.** v1 functions had 1024 MB. An isolate also serves several requests at once, unlike a Lambda instance, so module-level state is shared between requests in flight. Request bodies are buffered in memory, and Lambda's 6 MB payload limit is not enforced.
- **CPU time limits.** Workers Free allows 10 ms of CPU per request. Workers Paid allows 30 s by default, up to 5 minutes with `limits.cpu_ms`. Time spent waiting on I/O does not count. Lambda limited wall-clock time instead (10 s in v1); `timeoutMs` is only reported, never enforced.
- **No AWS environment.** There are no IAM role credentials, no `AWS_*` variables and no X-Ray. AWS SDK calls need explicit credentials.
- **No Function URL CORS by default.** Without `cors: 'v1'`, `OPTIONS` requests reach the handler, and the handler sets any CORS headers.
- **`callbackWaitsForEmptyEventLoop` has no effect.** The response is sent as soon as the handler completes. Work still running after that may be cut off.
- **No response streaming** (`awslambda.streamifyResponse`).
