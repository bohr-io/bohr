// Copies the sign-in container's image (runtime/claude-login, published as ghcr.io/bohr-io/claude-login:<version>)
// into a Cloudflare account's container registry, where the instance's ClaudeLoginContainer runs it from
// (see the "containers" entry of wrangler.jsonc and docs/self-hosting.md).
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node apps/instance/scripts/copy-login-image.mjs [source image]
//
// The token needs Containers: Edit on that account. The source defaults to the published image of the version in
// runtime/claude-login/package.json. Blobs already in the registry are skipped, so a failed copy can be re-run.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(here, '../../../runtime/claude-login/package.json'), 'utf8'));
const source = process.argv[2] ?? `ghcr.io/bohr-io/claude-login:${version}`;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!apiToken || !accountId) {
  console.error('Set CLOUDFLARE_API_TOKEN (with Containers: Edit) and CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}
const tag = /:([\w][\w.-]{0,127})$/.exec(source)?.[1] ?? version;

// @bohr/cloudflare is TypeScript source: bundle the two functions this script needs
const bundled = await build({
  stdin: {
    contents: "export { CloudflareClient, copyImageToAccount } from '@bohr/cloudflare';",
    resolveDir: here,
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  write: false,
  logLevel: 'warning',
});
const code = bundled.outputFiles[0].text;
const { CloudflareClient, copyImageToAccount } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

console.log(`Copying ${source} into account ${accountId}…`);
const cf = new CloudflareClient({ apiToken, accountId, userAgent: `bohr-copy-login-image/${version}` });
const { reference } = await copyImageToAccount({ cf, accountId, source, repository: 'bohr-claude-login', tag });
console.log(`Copied: ${reference}`);
console.log(`In wrangler.jsonc, "containers" › "image": registry.cloudflare.com/${accountId}/bohr-claude-login:${tag}`);
