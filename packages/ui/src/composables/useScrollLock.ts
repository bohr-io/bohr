import { onScopeDispose } from 'vue';

// Shared by every lock holder, so nested modals keep the page locked until the last one closes.
let lockCount = 0;
let saved: { htmlOverflow: string; bodyOverflow: string; bodyPaddingRight: string } | null = null;

export interface ScrollLockOptions {
  /**
   * Pads the body by the scrollbar's width so the page does not shift when the scrollbar goes (default). Off
   * for views that cover the whole window, which the padding would leave short of its right edge.
   */
  keepLayout?: boolean;
}

export function lockBodyScroll(options: ScrollLockOptions = {}): void {
  if (typeof document === 'undefined') return;
  lockCount += 1;
  if (lockCount > 1) return;

  const html = document.documentElement;
  const body = document.body;
  const scrollbarWidth = window.innerWidth - html.clientWidth;
  saved = {
    htmlOverflow: html.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPaddingRight: body.style.paddingRight,
  };
  html.style.overflow = 'hidden';
  body.style.overflow = 'hidden';
  // Keep the layout from shifting when the scrollbar disappears.
  if (scrollbarWidth > 0 && options.keepLayout !== false) body.style.paddingRight = `${scrollbarWidth}px`;
}

export function unlockBodyScroll(): void {
  if (typeof document === 'undefined' || lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;

  document.documentElement.style.overflow = saved?.htmlOverflow ?? '';
  document.body.style.overflow = saved?.bodyOverflow ?? '';
  document.body.style.paddingRight = saved?.bodyPaddingRight ?? '';
  saved = null;
}

/** Locks page scroll while held; released automatically when the owner scope is disposed. */
export function useScrollLock(options: ScrollLockOptions = {}) {
  let locked = false;

  function lock() {
    if (locked) return;
    locked = true;
    lockBodyScroll(options);
  }

  function unlock() {
    if (!locked) return;
    locked = false;
    unlockBodyScroll();
  }

  onScopeDispose(unlock);

  return { lock, unlock, isLocked: () => locked };
}
