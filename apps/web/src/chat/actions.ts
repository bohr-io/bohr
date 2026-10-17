// Member actions on the conversation, shared by the chat and the preview panel: one at a time, with
// the project's reply shown as a toast (it is already in the user's language).
import type { ChatEntry } from '@bohr/shared';
import { useToast } from '@bohr/ui';
import { ref } from 'vue';
import { useErrorToast } from '../composables/useErrorText';
import type { ChatFeed } from './feed';

export function useProjectActions(feed: ChatFeed) {
  const toast = useToast();
  const showError = useErrorToast();
  /** The action in progress: "approve", "discard", "answer:<seq>" or "cancel:<requestId>". */
  const busy = ref<string | null>(null);

  async function run(key: string, action: () => Promise<string>): Promise<boolean> {
    if (busy.value !== null) return false;
    busy.value = key;
    try {
      const message = await action();
      if (message) toast.tip(message);
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      busy.value = null;
    }
  }

  return {
    busy,
    decide: (action: 'approve' | 'discard') => run(action, () => feed.decide(action)),
    answer: (entry: ChatEntry, option: number) =>
      run(`answer:${entry.seq}`, async () => (await feed.answer(entry, option)).message),
    cancel: (requestId: string) => run(`cancel:${requestId}`, () => feed.cancel(requestId)),
  };
}

export type ProjectActions = ReturnType<typeof useProjectActions>;
