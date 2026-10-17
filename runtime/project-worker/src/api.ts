import {
  answerSchema,
  type ChatEntry,
  claudeLoginCancelSchema,
  claudeLoginFinishSchema,
  decisionSchema,
  joinSchema,
  normalizeLocale,
  postMessageSchema,
  settingsPatchSchema,
} from '@bohr/shared';
import type { z } from 'zod';
import type { Caller } from './auth';
import { RunnerError } from './container';
import type { Origin, Project } from './project';

export type ApiCall = { method: string; path: string; query: Record<string, string>; body: unknown; caller: Caller };
export type ApiResult = { status: number; body: unknown };

const ok = (body: unknown): ApiResult => ({ status: 200, body });
const error = (status: number, code: string, message?: string): ApiResult => ({
  status,
  body: { error: code, ...(message ? { message } : {}) },
});

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> | ApiResult {
  const result = schema.safeParse(body);
  return result.success ? result.data : error(400, 'invalid_request', result.error.issues[0]?.message);
}
const isResult = (value: unknown): value is ApiResult =>
  typeof value === 'object' &&
  value !== null &&
  'status' in value &&
  'body' in value &&
  Object.keys(value).length === 2;

/** The runtime API (see @bohr/shared runtime-api) as the Durable Object serves it. */
export async function handleApi(project: Project, call: ApiCall): Promise<ApiResult> {
  const { method, path, caller } = call;
  const locale = normalizeLocale(caller.locale, project.locale);
  const origin: Origin = { source: 'web', locale };

  if (method === 'POST' && path === '/join') {
    const input = parse(joinSchema, call.body);
    if (isResult(input)) return input;
    const result = await project.join({ key: caller.key, name: caller.name }, input.code);
    return result === 'invalid' ? error(400, 'invalid_code') : ok({ joined: result === 'joined' });
  }

  const actor = project.actorFor(caller.key, caller.name, caller.aliases, caller.grant);
  if (actor === null) return error(403, 'not_a_member');

  if (method === 'GET' && path === '/state') return ok(project.state(actor));

  if (method === 'GET' && path === '/messages') {
    const after = Math.max(0, Number(call.query.after ?? 0) || 0);
    const limit = Math.min(200, Math.max(1, Number(call.query.limit ?? 100) || 100));
    const messages: ChatEntry[] = project.store.chat(after, limit).map((row) => ({
      seq: row.seq,
      at: row.at,
      kind: row.kind,
      requestId: row.request_id,
      author: row.author_key === null ? null : { key: row.author_key, name: row.author_name ?? row.author_key },
      text: row.text,
      actions: JSON.parse(row.actions) as ChatEntry['actions'],
      options: JSON.parse(row.options) as string[],
    }));
    return ok({ messages, last: project.store.lastChatSeq() });
  }

  if (method === 'POST' && path === '/messages') {
    const input = parse(postMessageSchema, call.body);
    if (isResult(input)) return input;
    const result = await project.submit(actor, input.text, origin);
    return result.requestId === undefined
      ? error(409, 'not_accepted', result.text)
      : ok({ requestId: result.requestId, message: result.text });
  }

  if (method === 'POST' && path === '/import') {
    if (actor.role !== 'owner') return error(403, 'owner_only');
    // The instance starts the first import by itself: it shows as bohr's, not as the owner's
    const automatic = (call.body as { automatic?: unknown } | null)?.automatic === true;
    const result = await project.startImport(actor, origin, automatic);
    return result.requestId === undefined
      ? error(409, 'not_accepted', result.text)
      : ok({ requestId: result.requestId, message: result.text });
  }

  // The owner's Claude subscription (the instance stores the token for every project they own)
  if (method === 'POST' && path.startsWith('/claude-login/')) {
    if (actor.role !== 'owner') return error(403, 'owner_only');
    try {
      if (path === '/claude-login/start') return ok(await project.claudeLoginStart());
      if (path === '/claude-login/finish') {
        const input = parse(claudeLoginFinishSchema, call.body);
        if (isResult(input)) return input;
        return ok(await project.claudeLoginFinish(input.loginId, input.code));
      }
      if (path === '/claude-login/cancel') {
        const input = parse(claudeLoginCancelSchema, call.body);
        if (isResult(input)) return input;
        await project.claudeLoginCancel(input.loginId);
        return ok({ cancelled: true });
      }
    } catch (caught) {
      // The runner's refusals keep their status (409 another sign-in, 404 expired, 422 code refused, 504)
      if (caught instanceof RunnerError && [400, 404, 409, 422, 504].includes(caught.status)) {
        return error(caught.status, caught.code, caught.message);
      }
      console.error('[api] Claude sign-in failed:', caught instanceof Error ? caught.message : caught);
      return error(502, 'agent_unavailable', 'The agent container could not run the sign-in to Claude.');
    }
    return error(404, 'not_found');
  }

  if (method === 'POST' && path === '/decisions') {
    const input = parse(decisionSchema, call.body);
    if (isResult(input)) return input;
    return ok({ message: await project.decide(actor, input.action, input.version, origin) });
  }

  if (method === 'POST' && path === '/answers') {
    const input = parse(answerSchema, call.body);
    if (isResult(input)) return input;
    const result =
      input.option !== undefined
        ? await project.answer(actor, input.requestId, input.option, origin)
        : await project.submit(actor, input.text ?? '', origin);
    return result.requestId === undefined
      ? error(409, 'not_accepted', result.text)
      : ok({ requestId: result.requestId, message: result.text });
  }

  const cancel = /^\/requests\/([A-Za-z0-9_-]{1,64})\/cancel$/.exec(path);
  if (method === 'POST' && cancel?.[1] !== undefined) {
    return ok({ message: await project.cancel(actor, cancel[1], origin) });
  }

  if (method === 'POST' && path === '/rollback') return ok({ message: await project.rollback(actor, origin) });

  if (method === 'POST' && path === '/invites') {
    const invite = await project.createInvite(actor);
    return invite === null ? error(403, 'owner_only') : ok(invite);
  }

  if (method === 'GET' && path === '/preview') return ok(await project.previewDiagnostics());

  // The instance, after a runtime update (its token vouches for the owner)
  if (method === 'POST' && path === '/restart') {
    if (actor.role !== 'owner') return error(403, 'owner_only');
    return ok({ result: await project.restartForUpdate() });
  }

  if (method === 'GET' && path === '/members') {
    return ok({
      members: project.store
        .members()
        .map((member) => ({ key: member.key, name: member.name, role: member.role, joinedAt: member.joined_at })),
    });
  }

  const member = /^\/members\/([^/]{1,100})$/.exec(path);
  if (method === 'DELETE' && member?.[1] !== undefined) {
    const { result } = project.revoke(actor, decodeURIComponent(member[1]));
    if (result === 'revoked') return ok({ revoked: true });
    return result === 'owner_only'
      ? error(403, 'owner_only')
      : result === 'owner'
        ? error(400, 'cannot_revoke_owner')
        : error(404, 'not_found');
  }

  if (method === 'PATCH' && path === '/settings') {
    const input = parse(settingsPatchSchema, call.body);
    if (isResult(input)) return input;
    return project.updateSettings(actor, input) ? ok(project.state(actor).settings) : error(403, 'owner_only');
  }

  return error(404, 'not_found');
}
