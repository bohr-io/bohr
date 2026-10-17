import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOAST_DURATION, useToast } from './useToast';

describe('useToast', () => {
  const toast = useToast();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    toast.clear();
    vi.useRealTimers();
  });

  it('queues toasts in order with their types', () => {
    toast.success('Saved');
    toast.warn('Careful');
    toast.error('Failed');
    toast.show({ message: 'Did you know?' });

    expect(toast.toasts.map(({ message, type }) => [message, type])).toEqual([
      ['Saved', 'success'],
      ['Careful', 'warn'],
      ['Failed', 'error'],
      ['Did you know?', 'tip'],
    ]);
    expect(new Set(toast.toasts.map(({ id }) => id)).size).toBe(4);
  });

  it('shares the queue between callers', () => {
    useToast().tip('From somewhere else');

    expect(toast.toasts).toHaveLength(1);
  });

  it('dismisses a toast through its handle or its id', () => {
    const dismissFirst = toast.success('First');
    toast.success('Second');
    toast.success('Third');

    dismissFirst();
    expect(toast.toasts.map(({ message }) => message)).toEqual(['Second', 'Third']);

    const second = toast.toasts[0];
    if (second) toast.dismiss(second.id);
    expect(toast.toasts.map(({ message }) => message)).toEqual(['Third']);
  });

  it('dismisses toasts automatically after their duration', () => {
    toast.success('Default duration');
    toast.success('Short', { duration: 1000 });

    vi.advanceTimersByTime(1000);
    expect(toast.toasts.map(({ message }) => message)).toEqual(['Default duration']);

    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION);
    expect(toast.toasts).toHaveLength(0);
  });

  it('keeps persistent toasts until dismissed', () => {
    const onClick = vi.fn();
    const dismiss = toast.warn('Saving…', { persistent: true, action: { text: 'Undo', onClick } });

    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION * 10);
    expect(toast.toasts).toHaveLength(1);
    toast.toasts[0]?.action?.onClick();
    expect(onClick).toHaveBeenCalledOnce();

    dismiss();
    expect(toast.toasts).toHaveLength(0);
  });

  it('ignores unknown ids and repeated dismissals', () => {
    const dismiss = toast.tip('Once');

    dismiss();
    dismiss();
    toast.dismiss(-1);
    expect(toast.toasts).toHaveLength(0);
  });
});
