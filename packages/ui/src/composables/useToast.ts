import { reactive, readonly } from 'vue';

export type ToastType = 'success' | 'warn' | 'error' | 'tip';

export interface ToastAction {
  text: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds before the toast closes itself. Defaults to 4000. */
  duration?: number;
  /** Keep the toast until it is dismissed (v1's `isFixed`). */
  persistent?: boolean;
}

export interface ToastInput extends ToastOptions {
  message: string;
  type?: ToastType;
}

export const DEFAULT_TOAST_DURATION = 4000;

// One queue for the whole app, shown in order by <ToastDisplay>. Toasts are client-only.
const state = reactive({ toasts: [] as ToastItem[] });
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const index = state.toasts.findIndex((toast) => toast.id === id);
  if (index !== -1) state.toasts.splice(index, 1);
}

/** Queues a toast and returns a function that dismisses it. */
function show(input: ToastInput): () => void {
  const id = nextId++;
  state.toasts.push({ id, message: input.message, type: input.type ?? 'tip', action: input.action });

  const duration = input.persistent ? 0 : (input.duration ?? DEFAULT_TOAST_DURATION);
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), duration),
    );
  }
  return () => dismiss(id);
}

function clear(): void {
  for (const toast of [...state.toasts]) dismiss(toast.id);
}

const helper = (type: ToastType) => (message: string, options?: ToastOptions) => show({ ...options, message, type });

const api = {
  toasts: readonly(state.toasts),
  show,
  success: helper('success'),
  warn: helper('warn'),
  error: helper('error'),
  tip: helper('tip'),
  dismiss,
  clear,
};

export function useToast() {
  return api;
}
