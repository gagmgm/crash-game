import type { Unsubscribe } from '../types/network';

/**
 * Subscribes to page visibility. The callback receives how long the page was hidden,
 * so consumers can resync instead of assuming every frame/timer ran in the background.
 */
export function onPageVisibility(
  callback: (visible: boolean, hiddenForMs: number) => void,
): Unsubscribe {
  if (typeof document === 'undefined') return () => {};
  let hiddenAt: number | null = document.hidden ? performance.now() : null;
  const handler = () => {
    if (document.hidden) {
      hiddenAt = performance.now();
      callback(false, 0);
    } else {
      const hiddenFor = hiddenAt === null ? 0 : performance.now() - hiddenAt;
      hiddenAt = null;
      callback(true, hiddenFor);
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}
