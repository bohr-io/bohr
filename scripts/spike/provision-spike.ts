// Checks, against a real Cloudflare account, the API calls bohr makes to provision a project runtime
// that were built from wrangler's source and could not be tested locally:
//   1. copy a public image into the account's registry (OCI, no docker)
//   2. prepare it for Containers
//   3. upload a Worker whose Durable Object owns a container (scheduling_policy durable_object)
//   4. create the container application for its namespace
//   5. start the container, reach a port inside it, and intercept its outbound HTTP through ctx.exports
// Run: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/spike/run.mjs [--keep] [--image <ref>]
import {
  CloudflareClient,
  copyImageToAccount,
  deleteAccountScript,
  enableWorkersDevForScript,
  ensureContainerApplication,
  findDurableObjectNamespaceId,
  getWorkersSubdomain,
  prepareContainerImage,
  uploadAccountScript,
  workersDevUrl,
} from '../../packages/cloudflare/src/index';

const SPIKE_WORKER = `import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';

export class Echo extends WorkerEntrypoint {
  fetch(request) {
    return new Response('intercepted ' + new URL(request.url).pathname);
  }
}

export class Spike extends DurableObject {
  async fetch() {
    const container = this.ctx.container;
    if (!container) return Response.json({ error: 'no container on this Durable Object' }, { status: 500 });
    const steps = {};
    if (!container.running) {
      try {
        await container.interceptOutboundHttp('bohr.internal', this.ctx.exports.Echo({ props: {} }));
        steps.intercept = 'registered';
      } catch (error) {
        steps.intercept = 'failed: ' + error;
      }
      container.start({
        image: container.images.spike,
        enableInternet: false,
        entrypoint: ['sh', '-c', 'mkdir -p /www && echo ok > /www/index.html && httpd -f -p 8080 -h /www'],
      });
    }
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const page = await container.getTcpPort(8080).fetch('http://container/index.html');
        if (page.ok) {
          steps.port = (await page.text()).trim();
          const process = await container.exec(['wget', '-qO-', 'http://bohr.internal/ping']);
          const output = await process.output();
          steps.outbound = new TextDecoder().decode(output.stdout).trim() || 'exit ' + output.exitCode;
          return Response.json(steps);
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return Response.json({ ...steps, error: 'the container did not answer on port 8080' }, { status: 504 });
  }
}

export default {
  fetch(request, env) {
    return env.SPIKE.getByName('spike').fetch(request);
  },
};
`;

type Step = { name: string; ok: boolean; detail: string };

async function main() {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: given by whoever runs the spike, not a build input
  const token = process.env.CLOUDFLARE_API_TOKEN;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: given by whoever runs the spike, not a build input
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) throw new Error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const imageIndex = args.indexOf('--image');
  const source = imageIndex >= 0 ? (args[imageIndex + 1] ?? '') : 'docker.io/library/busybox:1.37';
  const cf = new CloudflareClient({ apiToken: token, accountId });
  const script = `bohr-spike-${Math.random().toString(36).slice(2, 8)}`;
  const steps: Step[] = [];
  const step = async <T>(name: string, run: () => Promise<T>, describe: (value: T) => string = String) => {
    const started = Date.now();
    try {
      const value = await run();
      steps.push({ name, ok: true, detail: `${describe(value)} (${Date.now() - started} ms)` });
      console.log(`PASS  ${name}: ${describe(value)}`);
      return value;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      steps.push({ name, ok: false, detail });
      console.log(`FAIL  ${name}: ${detail}`);
      throw error;
    }
  };

  try {
    const subdomain = await step('workers.dev subdomain', async () => {
      const found = await getWorkersSubdomain(cf, accountId);
      if (found === null) throw new Error('none: open Workers & Pages in the dashboard once');
      return found;
    });
    const image = await step(
      `copy ${source} into registry.cloudflare.com`,
      () => copyImageToAccount({ cf, accountId, source, repository: 'bohr-spike', tag: 'spike' }),
      (result) => result.reference,
    );
    await step(
      'prepare the image',
      () => prepareContainerImage(cf, accountId, image.reference),
      () => 'ready',
    );
    await step(
      `upload ${script} with a container Durable Object`,
      () =>
        uploadAccountScript(
          cf,
          accountId,
          script,
          {
            main_module: 'index.mjs',
            compatibility_date: '2026-08-15',
            compatibility_flags: ['nodejs_compat'],
            bindings: [{ type: 'durable_object_namespace', name: 'SPIKE', class_name: 'Spike' }],
            migrations: { new_tag: 'v1', new_sqlite_classes: ['Spike'] },
            containers: [{ class_name: 'Spike', images: { spike: image.reference } }],
          },
          [{ name: 'index.mjs', content: SPIKE_WORKER, type: 'application/javascript+module' }],
        ),
      (result) => `version ${result.etag ?? result.id}`,
    );
    const namespaceId = await step('find the Durable Object namespace', async () => {
      const id = await findDurableObjectNamespaceId(cf, accountId, script, 'Spike');
      if (id === null) throw new Error('not found');
      return id;
    });
    await step(
      'create the container application',
      () => ensureContainerApplication(cf, accountId, { name: script, namespaceId }),
      (result) => (result.created ? `created ${result.id}` : `exists ${result.id}`),
    );
    await step(
      'enable workers.dev',
      () => enableWorkersDevForScript(cf, accountId, script),
      () => 'enabled',
    );
    const url = workersDevUrl(script, subdomain);
    await step(
      `start the container through ${url}`,
      async () => {
        let last = '';
        for (let attempt = 0; attempt < 20; attempt++) {
          const response = await fetch(url).catch((error: unknown) => new Response(String(error), { status: 599 }));
          last = `${response.status} ${await response.text()}`;
          if (response.ok) return last;
          await new Promise((resolve) => setTimeout(resolve, 15_000));
        }
        throw new Error(last);
      },
      (body) => body,
    );
  } catch {
    // Each failure is already reported; clean up below.
  } finally {
    if (!keep) {
      await deleteAccountScript(cf, accountId, script, { force: true }).catch(() => {});
      console.log(`\nDeleted ${script}. The copied image stays in the registry (bohr-spike:spike).`);
    }
  }
  const failed = steps.filter((item) => !item.ok);
  console.log(failed.length === 0 ? '\nAll steps passed.' : `\n${failed.length} step(s) failed.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main();
