import { describe, expect, it } from 'vitest';
import { chatEntry, projectState } from '../test-utils';
import { activeDecisionSeq, activeQuestionSeq, canCancel, isBusy, previewDiffUrl } from './decisions';

const pending = projectState({ homolog: { status: 'pending', version: 3, headSha: 'abc', changes: [] } });

describe('preview diff', () => {
  it('links the production branch to the pinned preview commit', () => {
    const state = projectState({ homolog: { status: 'pending', version: 3, headSha: 'abc123', changes: [] } });
    const { repository, productionBranch } = state.project;
    expect(previewDiffUrl(state)).toBe(`https://github.com/${repository}/compare/${productionBranch}...abc123`);
    expect(
      previewDiffUrl(projectState({ homolog: { status: 'clean', version: 0, headSha: null, changes: [] } })),
    ).toBeNull();
    expect(previewDiffUrl(null)).toBeNull();
  });
});

describe('live chat actions', () => {
  it('keeps only the newest decision live, and only while the preview has changes', () => {
    const entries = [
      chatEntry(1, { actions: ['approve', 'discard'] }),
      chatEntry(2, { kind: 'user' }),
      chatEntry(3, { actions: ['approve', 'discard'] }),
      chatEntry(4, { kind: 'system' }),
    ];

    expect(activeDecisionSeq(entries, pending)).toBe(3);
    expect(activeDecisionSeq(entries, projectState())).toBeNull();
    expect(activeDecisionSeq(entries, null)).toBeNull();
    expect(activeDecisionSeq([chatEntry(1)], pending)).toBeNull();
  });

  it('keeps a question open until a member writes after it', () => {
    const question = chatEntry(2, { requestId: 'req_1', actions: ['answer'], options: ['Azul', 'Verde'] });

    expect(activeQuestionSeq([chatEntry(1), question, chatEntry(3, { kind: 'system' })])).toBe(2);
    expect(activeQuestionSeq([question, chatEntry(3, { kind: 'user' })])).toBeNull();
    expect(activeQuestionSeq([chatEntry(1, { actions: ['answer'], options: [] })])).toBeNull();
  });

  it('lets the author or the owner cancel a running or queued request', () => {
    const request = {
      id: 'req_1',
      status: 'queued' as const,
      text: 'x',
      author: { key: 'u:other', name: 'Bia' },
      source: 'web' as const,
      createdAt: '2026-10-11T12:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      summary: null,
      costUsd: null,
      progress: null,
    };
    const owner = projectState({ queue: [request] });
    const member = projectState({ queue: [request], you: { key: 'u:me', role: 'member' } });
    const author = projectState({ queue: [request], you: { key: 'u:other', role: 'member' } });

    expect(canCancel(owner, 'req_1')).toBe(true);
    expect(canCancel(member, 'req_1')).toBe(false);
    expect(canCancel(author, 'req_1')).toBe(true);
    expect(canCancel(owner, 'req_2')).toBe(false);
    expect(isBusy(owner)).toBe(true);
    expect(isBusy(projectState())).toBe(false);
  });
});
