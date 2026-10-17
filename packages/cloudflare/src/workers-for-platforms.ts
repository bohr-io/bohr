import type { CloudflareClient } from './client';

// Workers for Platforms: customer Workers live as scripts inside a dispatch namespace

export type AssetsManifest = Record<string, { hash: string; size: number }>;

export type AssetsUploadSession = {
  // Upload token while buckets remain; already the completion token when buckets is empty
  jwt: string;
  buckets: string[][];
};

export type AssetsConfig = {
  not_found_handling?: 'single-page-application' | '404-page' | 'none';
  html_handling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none';
  run_worker_first?: boolean | string[];
  // Contents of the _redirects and _headers files, as wrangler sends them
  _redirects?: string;
  _headers?: string;
};

export type ScriptBinding =
  | { type: 'plain_text'; name: string; text: string }
  | { type: 'secret_text'; name: string; text: string }
  | { type: 'assets'; name: string };

export type ScriptMetadata = {
  main_module: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  bindings?: ScriptBinding[];
  assets?: { jwt: string; config?: AssetsConfig };
  keep_bindings?: string[];
  tags?: string[];
  /** Version annotations: the deploy message and tag shown in the dashboard's deployments list. */
  annotations?: { 'workers/message'?: string; 'workers/tag'?: string };
  observability?: { enabled: boolean };
};

export type ScriptModule = {
  name: string;
  content: string | ArrayBuffer | Uint8Array;
  type: string;
};

const encode = encodeURIComponent;

// Multipart body of a script upload: the metadata JSON part, then one part per module with its content type
export function scriptUploadForm(metadata: unknown, modules: ScriptModule[]): FormData {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  for (const module of modules) {
    form.append(module.name, new Blob([module.content], { type: module.type }), module.name);
  }
  return form;
}

export function dispatchScriptPath(client: CloudflareClient, namespace: string, script: string) {
  return `${client.accountPath}/workers/dispatch/namespaces/${encode(namespace)}/scripts/${encode(script)}`;
}

export async function createDispatchAssetsUploadSession(
  client: CloudflareClient,
  namespace: string,
  script: string,
  manifest: AssetsManifest,
): Promise<AssetsUploadSession> {
  const result = await client.request<{ jwt: string; buckets?: string[][] }>(
    'POST',
    `${dispatchScriptPath(client, namespace, script)}/assets-upload-session`,
    { json: { manifest } },
  );
  return { jwt: result.jwt, buckets: result.buckets ?? [] };
}

export async function putDispatchScript(
  client: CloudflareClient,
  namespace: string,
  script: string,
  metadata: ScriptMetadata,
  modules: ScriptModule[],
) {
  return client.request<{ id?: string; etag?: string; modified_on?: string }>(
    'PUT',
    dispatchScriptPath(client, namespace, script),
    { form: scriptUploadForm(metadata, modules) },
  );
}

export async function deleteDispatchScript(client: CloudflareClient, namespace: string, script: string) {
  await client.request<unknown>('DELETE', dispatchScriptPath(client, namespace, script), { query: { force: true } });
}

export async function putDispatchScriptSecret(
  client: CloudflareClient,
  namespace: string,
  script: string,
  name: string,
  text: string,
) {
  await client.request<unknown>('PUT', `${dispatchScriptPath(client, namespace, script)}/secrets`, {
    json: { name, text, type: 'secret_text' },
  });
}

export async function deleteDispatchScriptSecret(
  client: CloudflareClient,
  namespace: string,
  script: string,
  name: string,
) {
  await client.request<unknown>('DELETE', `${dispatchScriptPath(client, namespace, script)}/secrets/${encode(name)}`);
}

export async function listDispatchScriptSecrets(client: CloudflareClient, namespace: string, script: string) {
  return client.request<{ name: string; type: string }[]>(
    'GET',
    `${dispatchScriptPath(client, namespace, script)}/secrets`,
  );
}
