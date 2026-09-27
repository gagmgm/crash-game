import type { Unsubscribe } from '../../types/network';

/**
 * Minimal typed pub/sub. Used only for fire-and-forget visual cues from the controller
 * to the renderer (things that are not state, like "play the cash-out marker").
 * State itself flows through stores and RoundTimeline, not through the bus.
 */
export class EventBus<Events extends object> {
  private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (payload: never) => void);
    return () => {
      set.delete(handler as (payload: never) => void);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.handlers.get(type)?.forEach((handler) => (handler as (p: Events[K]) => void)(payload));
  }

  listenerCount(type: keyof Events): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
